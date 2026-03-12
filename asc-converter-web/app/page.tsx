'use client';

import { useState, useCallback } from 'react';
import Papa from 'papaparse';
import Link from 'next/link';

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
      let accumulatedCsv: any[] = [];

      const CHUNK_SIZE = 10;
      for (let i = 0; i < files.length; i += CHUNK_SIZE) {
        const fileBatch = files.slice(i, i + CHUNK_SIZE);

        let payloadData: any = null;
        let attempt = 0;
        const maxAttempts = 3;

        while (attempt < maxAttempts) {
          try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || '/api/upload';
            const res = await fetch(apiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                parsedFiles: fileBatch,
                isFirstBatch: i === 0 && attempt === 0
              })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            payloadData = data;
            break; // Break the while loop since it succeeded!
          } catch (fetchErr: any) {
            attempt++;
            console.error(`Attempt ${attempt} failed for file ${files[i].fileName}:`, fetchErr);
            if (attempt >= maxAttempts) {
              throw fetchErr; // Exhausted retries, crash the outer try-catch
            }
            // Wait 2000ms before retrying
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }

        if (payloadData && payloadData.flatCsvData) {
          accumulatedCsv = accumulatedCsv.concat(payloadData.flatCsvData);
        }

        // Update progress and calculate ETA
        const currentCount = Math.min(i + CHUNK_SIZE, files.length);
        setProgress(currentCount);
        const elapsedSeconds = (Date.now() - startTime) / 1000;
        const avgTimePerFile = elapsedSeconds / currentCount;
        const remainingFiles = files.length - currentCount;
        setEta(Math.round(avgTimePerFile * remainingFiles));

        // Add a 1-second delay between chunk requests to give Vercel and MongoDB some breathing room
        if (currentCount < files.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      setResponse({ success: true, flatCsvData: accumulatedCsv, finalJson: null });
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>Centro de Integración ASC</h1>
          <Link href="/cfdi-dashboard" style={{ background: '#217346', color: '#fff', padding: '10px 20px', borderRadius: '12px', textDecoration: 'none', fontWeight: 'bold', fontSize: '14px' }}>
            Ir a CFDI XML Dashboard 🚀
          </Link>
        </div>
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
                {isProcessing ? 'Procesando...' : 'Subir a MongoDB'}
              </button>
            </div>
          </div>

          {isProcessing && (
            <div style={{ marginTop: '20px', padding: '16px', borderRadius: '8px', background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <strong style={{ color: 'var(--primary)' }}>Subiendo datos: {progress} de {files.length} archivos</strong>
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
          <h2 style={{ color: 'var(--primary)' }}>✅ Sincronización Exitosa</h2>
          <p>Los datos ya se han ordenado e insertado exitosamente en tu colección de MongoDB leyendo la configuración automáticamente del archivo <b>.env</b> principal.</p>
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
