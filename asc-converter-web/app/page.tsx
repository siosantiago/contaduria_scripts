'use client';

import { useState, useCallback } from 'react';
import Papa from 'papaparse';

export default function Home() {
  const [files, setFiles] = useState<any[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
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

    try {
      let accumulatedCsv: any[] = [];

      for (let i = 0; i < files.length; i++) {
        const fileBatch = [files[i]];

        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parsedFiles: fileBatch,
            isFirstBatch: i === 0
          })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        if (data.flatCsvData) {
          accumulatedCsv = accumulatedCsv.concat(data.flatCsvData);
        }
      }

      setResponse({ success: true, flatCsvData: accumulatedCsv, finalJson: null });
    } catch (err: any) {
      alert(`Error interactuando con Mongo: ${err.message}`);
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
    const csv = Papa.unparse(response.flatCsvData);
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
                {isProcessing ? 'Sincronizando...' : 'Subir a MongoDB'}
              </button>
            </div>
          </div>
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
