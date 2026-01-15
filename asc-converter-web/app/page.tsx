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
        console.error('Error processing file:', file.name, err);
        alert(`Error processing ${file.name}`);
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
        alert(`Error processing ${file.name}`);
      }
    }
  };

  return (
    <main className="main-container">
      <div className="header">
        <h1>ASC Converter</h1>
        <p>Convert your pipe-delimited accounting files to Excel in seconds.</p>
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
        <h2>Drop files here</h2>
        <p>or click to browse from your computer</p>
      </div>

      {files.length > 0 && (
        <div className="file-list">
          {files.map((file, idx) => (
            <div key={idx} className="file-card">
              <div className="file-info">
                <h3>{file.fileName}</h3>
                <span>{file.data.length} rows detected</span>
              </div>
              <div className="file-actions">
                <button
                  className="action-btn secondary"
                  onClick={() => setPreviewFile(file)}
                >
                  Preview
                </button>
                <button
                  className="action-btn"
                  onClick={() => downloadExcel(file)}
                >
                  Download Excel
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {previewFile && (
        <div className="preview-section">
          <div style={{ padding: '20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Preview: {previewFile.fileName}</h2>
            <span style={{ color: '#64748b', fontSize: '0.9rem' }}>Showing first 10 rows</span>
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
