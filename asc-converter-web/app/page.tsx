'use client';

import { useState, useCallback } from 'react';
import { processAscFile, downloadExcel, ProcessedData } from '@/lib/convert';

export default function Home() {
  const [files, setFiles] = useState<ProcessedData[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [previewFile, setPreviewFile] = useState<ProcessedData | null>(null);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const uploadedFiles = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.asc'));

    for (const file of uploadedFiles) {
      try {
        const processed = await processAscFile(file);
        setFiles(prev => [...prev, processed]);
        if (!previewFile) setPreviewFile(processed);
      } catch (err) {
        console.error('Error procesando archivo:', file.name, err);
        alert(`Error procesando ${file.name}`);
      }
    }
  }, [previewFile]);

  const onFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const uploadedFiles = Array.from(e.target.files).filter(f => f.name.toLowerCase().endsWith('.asc'));

    for (const file of uploadedFiles) {
      try {
        const processed = await processAscFile(file);
        setFiles(prev => [...prev, processed]);
        if (!previewFile) setPreviewFile(processed);
      } catch (err) {
        alert(`Error procesando ${file.name}`);
      }
    }
  };

  const downloadAll = () => {
    files.forEach(file => downloadExcel(file));
  };

  const clearAll = () => {
    setFiles([]);
    setPreviewFile(null);
  };

  return (
    <main className="main-container">
      <div className="header">
        <h1>Convertidor ASC</h1>
        <p>Convierte tus archivos contables delimitados por tubería (|) a Excel en segundos.</p>
      </div>

      <div className="instructions-section">
        <h2>¿Cómo usar?</h2>
        <ol>
          <li>Arrastra tus archivos <b>.asc</b> al recuadro de abajo o haz clic para seleccionarlos.</li>
          <li>Los archivos se procesarán automáticamente convirtiendo campos numéricos y eliminando espacios innecesarios.</li>
          <li>Puedes visualizar una vista previa de los primeros 10 renglones de cada archivo.</li>
          <li>Descarga los archivos individualmente o usa el botón <b>"Descargar Todo"</b> para bajarlos todos a la vez.</li>
        </ol>
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
        <h2>Suelte sus archivos aquí</h2>
        <p>o haga clic para buscar en su equipo</p>
      </div>

      {files.length > 0 && (
        <>
          <div className="list-header">
            <h2>Archivos Procesados</h2>
            <div className="list-actions">
              <button
                className="action-btn secondary"
                onClick={clearAll}
              >
                Limpiar Lista
              </button>
              <button
                className="action-btn"
                onClick={downloadAll}
              >
                Descargar Todo ({files.length})
              </button>
            </div>
          </div>

          <div className="file-list">
            {files.map((file, idx) => (
              <div key={idx} className="file-card">
                <div className="file-info">
                  <h3>{file.fileName}</h3>
                  <span>{file.data.length} filas detectadas</span>
                </div>
                <div className="file-actions">
                  <button
                    className="action-btn secondary"
                    onClick={() => setPreviewFile(file)}
                  >
                    Vista Previa
                  </button>
                  <button
                    className="action-btn"
                    onClick={() => downloadExcel(file)}
                  >
                    Descargar Excel
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {previewFile && (
        <div className="preview-section">
          <div style={{ padding: '20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Vista Previa: {previewFile.fileName}</h2>
            <span style={{ color: '#64748b', fontSize: '0.9rem' }}>Mostrando las primeras 10 filas</span>
          </div>
          <table>
            <thead>
              <tr>
                {previewFile.headers.slice(0, 8).map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewFile.data.slice(0, 10).map((row, i) => (
                <tr key={i}>
                  {previewFile.headers.slice(0, 8).map(h => (
                    <td key={h}>{row[h]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
