'use client';

import { useState, useCallback } from 'react';
import Papa from 'papaparse';

export default function Home() {
  const [files, setFiles] = useState<any[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [eta, setEta] = useState(0);
  const [response, setResponse] = useState<any>(null);

  const parseFileLocally = async (file: File) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const arrayBuffer = event.target?.result as ArrayBuffer;
          const decoder = new TextDecoder('windows-1252');
          const text = decoder.decode(arrayBuffer);

          Papa.parse(text, {
            delimiter: '|',
            header: true,
            skipEmptyLines: 'greedy',
            transformHeader: (header) => header.trim(),
            complete: (results) => {
              let data = results.data as any[];
              const numericPrefixes = ['Total', 'Valor', 'Peso', 'Importe', 'Cantidad'];
              const specificCols = ['TotalFletes', 'TotalSeguros', 'TotalEmbalajes',
                'TotalIncrementables', 'TotalDeducibles', 'PesoBrutoMercancia', 'PrecioUnitario'];

              data = data.map(row => {
                const newRow = { ...row };
                Object.keys(newRow).forEach(col => {
                  const isNumericCol = numericPrefixes.some(p => col.startsWith(p)) || specificCols.includes(col);
                  if (isNumericCol) {
                    const val = String(newRow[col] || '0').replace(/,/g, '');
                    newRow[col] = parseFloat(val) || 0;
                  }
                });
                return newRow;
              });

              resolve({ fileName: file.name, data });
            },
            error: (err: Error) => reject(err)
          });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = (error) => reject(error);
      reader.readAsArrayBuffer(file);
    });
  };

  const handleFiles = async (uploaded: File[]) => {
    const ascFiles = uploaded.filter(f => f.name.toLowerCase().endsWith('.asc'));
    const parsed: any[] = [];
    for (const file of ascFiles) {
      const result = await parseFileLocally(file);
      parsed.push(result);
    }
    setFiles(prev => [...prev, ...parsed]);
  };

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    await handleFiles(Array.from(e.dataTransfer.files));
  }, []);

  const onFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    await handleFiles(Array.from(e.target.files));
  };

  const clearAll = () => {
    setFiles([]);
    setResponse(null);
  };

  const processAndUpload = async () => {
    setIsProcessing(true);
    setResponse(null);
    setProgress(0);
    setEta(0);

    const startTime = Date.now();

    try {
      const documentsToInsert: any[] = [];
      const excelExportRows: any[] = [];

      // 1. First iteration to standardize files structure
      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        for (const rawRow of file.data) {
          let patente = rawRow['Patente'] || rawRow['SeccionAduanera'];
          let pedimento = rawRow['Pedimento'];

          if (!patente || !pedimento) continue;

          let monthYearStr = 'Unknown';
          const dateRaw = rawRow['FechaPagoReal'] || rawRow['FechaFacturacion'];
          if (dateRaw) {
            const d = new Date(dateRaw);
            if (!isNaN(d.getTime())) {
              const formatter = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
              monthYearStr = formatter.format(d).replace(' ', '-');
            }
          }

          const cleanRow = { ...rawRow };
          delete cleanRow['Patente'];
          delete cleanRow['Pedimento'];
          delete cleanRow['SeccionAduanera'];

          documentsToInsert.push({
            month_year: monthYearStr,
            Patente: String(patente),
            Pedimento: String(pedimento),
            row_data: cleanRow,
            source_file: file.fileName
          });
        }

        // Update progress UI
        setProgress(i + 1);
        const elapsedSeconds = (Date.now() - startTime) / 1000;
        const avgTimePerFile = elapsedSeconds / (i + 1);
        setEta(Math.round(avgTimePerFile * (files.length - (i + 1))));

        // Allow UI to render
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      // 2. Aggregate identically to route.ts
      const mergedData: any = {};
      let indexFallback = 0;

      const globalHeaders = new Set<string>();
      for (const doc of documentsToInsert) {
        Object.keys(doc.row_data).forEach(k => globalHeaders.add(k));
      }

      for (const doc of documentsToInsert) {
        const my = doc.month_year;
        const pat = doc.Patente;
        const ped = doc.Pedimento;
        const row = doc.row_data;

        if (!mergedData[my]) mergedData[my] = {};
        const key = `${pat}_${ped}`;

        if (!mergedData[my][key]) {
          mergedData[my][key] = {
            Patente: pat,
            Pedimento: ped,
            Partidas: []
          };
        }

        let casoKey = row['ComplementoCaso'];
        if (!casoKey || casoKey === '') {
          casoKey = `P_${indexFallback}`;
          indexFallback++;
        }

        const finalRow: any = {};
        globalHeaders.forEach(k => {
          const val = row[k];
          if (val !== '' && val !== null && val !== undefined) {
            finalRow[k] = val;
          } else {
            finalRow[k] = '';
          }
        });

        mergedData[my][key].Partidas.push({ [casoKey]: finalRow });

        excelExportRows.push({
          Month_Year: my,
          Patente: pat,
          Pedimento: ped,
          ComplementoCaso_Key: casoKey,
          SourceFile: doc.source_file,
          ...finalRow
        });
      }

      const finalDocMongo: any = { month_year: {} };
      for (const my of Object.keys(mergedData)) {
        const pedimentosList = [];
        for (const k of Object.keys(mergedData[my])) {
          pedimentosList.push(mergedData[my][k]);
        }
        finalDocMongo.month_year[my] = pedimentosList;
      }

      setResponse({ success: true, flatCsvData: excelExportRows, finalJson: finalDocMongo });
    } catch (err: any) {
      alert(`Error procesando los archivos: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadJson = () => {
    if (!response?.finalJson) return;
    const blob = new Blob([JSON.stringify(response.finalJson, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'export_pedimentos.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadCsv = () => {
    if (!response?.flatCsvData) return;

    // Globally extract every single unique column name across all files in the batch!
    const allHeaders = new Set<string>();
    response.flatCsvData.forEach((row: any) => {
      Object.keys(row).forEach(k => allHeaders.add(k));
    });

    // Provide explicit fields map to PapaParse so it forces empty padding for missing columns globally
    const csv = Papa.unparse({
      fields: Array.from(allHeaders),
      data: response.flatCsvData
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'export_pedimentos.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="main-container">
      <div className="header">
        <h1>Centro de Integración ASC</h1>
        <p>Convierte y sube múltiples archivos a tu base de datos de MongoDB.</p>
      </div>

      <div
        className={`drop-zone ${isDragging ? 'active' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => document.getElementById('file-input')?.click()}
      >
        <input
          id="file-input"
          type="file"
          multiple
          accept=".asc"
          onChange={onFileSelect}
          style={{ display: 'none' }}
        />
        <h2>📁 Arrastre archivos ASC aquí</h2>
        <p>O seleccione los archivos desde el explorador</p>
      </div>

      {files.length > 0 && (
        <div style={{ marginTop: '24px' }}>
          <div className="list-header" style={{ marginTop: 0 }}>
            <h2>Listos para cargar ({files.length})</h2>
            <div className="list-actions">
              <button className="action-btn secondary" onClick={clearAll} disabled={isProcessing}>Borrar Lista</button>
              <button className="action-btn" onClick={processAndUpload} disabled={isProcessing || files.length === 0}>
                {isProcessing ? 'Procesando...' : 'Generar Archivos (Sin BD)'}
              </button>
            </div>
          </div>

          {isProcessing && (
            <div style={{ marginTop: '20px', padding: '16px', borderRadius: '8px', background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <strong style={{ color: 'var(--primary)' }}>Procesando datos: {progress} de {files.length} archivos</strong>
                <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>Tiempo restante estimado: ~{eta} segundos</span>
              </div>
              <div style={{ width: '100%', height: '8px', background: '#e5e7eb', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: `${(progress / files.length) * 100}%`, height: '100%', background: 'var(--primary)', transition: 'width 0.3s' }}></div>
              </div>
            </div>
          )}
        </div>
      )}

      {response && response.success && (
        <div className="instructions-section" style={{ marginTop: '32px', borderLeft: '4px solid var(--primary)' }}>
          <h2 style={{ color: 'var(--primary)' }}>✅ Archivos Generados Exitosamente</h2>
          <p>Los datos han sido procesados localmente y están listos para descargar. Ya no dependen de MongoDB.</p>
          <div style={{ marginTop: '20px', display: 'flex', gap: '15px' }}>
            <button className="action-btn" onClick={downloadCsv} style={{ background: '#217346' }}>
              📊 Descargar Tabla (Excel CSV)
            </button>
            <button className="action-btn secondary" onClick={downloadJson}>
              Descargar Datos Crudos (JSON)
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
