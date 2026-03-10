"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, UploadCloud, FileText, Database, CheckCircle2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import styles from "./page.module.css";

type Invoice = {
    id: string;
    source_file: string;
    folio: string;
    fecha: string;
    emisor_rfc: string;
    emisor_nombre: string;
    receptor_rfc: string;
    receptor_nombre: string;
    total: number;
    created_at: string;
};

export default function CfdiDashboard() {
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchInvoices = useCallback(async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from("invoices")
                .select("*")
                .order("created_at", { ascending: false })
                .limit(100); // just fetch top 100 for dashboard

            if (error) throw error;
            setInvoices(data || []);
        } catch (err) {
            console.error("Error fetching invoices:", err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchInvoices();
    }, [fetchInvoices]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const files = Array.from(e.target.files).filter(f => f.name.toLowerCase().endsWith(".xml"));
        if (files.length === 0) {
            alert("No XML files found in the selected folder.");
            return;
        }

        setUploading(true);
        setProgress(0);

        const BATCH_SIZE = 50;
        const totalBatches = Math.ceil(files.length / BATCH_SIZE);

        try {
            for (let i = 0; i < totalBatches; i++) {
                const batchFiles = files.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);

                // Read file contents
                const fileDataPromises = batchFiles.map(file => {
                    return new Promise<{ fileName: string, content: string }>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (e) => resolve({ fileName: file.name, content: e.target?.result as string });
                        reader.onerror = (e) => reject(e);
                        reader.readAsText(file);
                    });
                });

                const batchData = await Promise.all(fileDataPromises);

                // Send to Python backend
                const res = await fetch("http://localhost:8000/api/upload-xml", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ files: batchData })
                });

                if (!res.ok) {
                    const err = await res.text();
                    console.error("Batch error:", err);
                }

                setProgress(Math.round(((i + 1) / totalBatches) * 100));
            }

            await fetchInvoices(); // Refresh the list
            alert("Upload complete!");
        } catch (err) {
            console.error("Error during upload:", err);
            alert("An error occurred during upload. Check console for details.");
        } finally {
            setUploading(false);
            setProgress(0);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    };

    const totalAmount = invoices.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0);

    return (
        <div className={styles.container}>
            <div className={styles.dashboardCard}>
                <header className={styles.header}>
                    <div>
                        <Link href="/" className={styles.navLink}>
                            <ArrowLeft size={16} />
                            Volver al Convertidor ASC
                        </Link>
                        <h1>Dashboard de Facturas CFDI</h1>
                    </div>
                </header>

                <div className={styles.uploadZone} onClick={() => !uploading && fileInputRef.current?.click()}>
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        // @ts-ignore
                        webkitdirectory="true"
                        directory="true"
                        multiple
                        disabled={uploading}
                    />
                    <UploadCloud size={48} className={styles.icon} />
                    <span className={styles.primaryText}>
                        {uploading ? `Procesando... ${progress}%` : "Arrastra una carpeta de archivos XML aquí"}
                    </span>
                    <span className={styles.secondaryText}>
                        {uploading ? "Por favor no cierre esta ventana" : "O haz clic para seleccionar una carpeta"}
                    </span>
                </div>

                <div className={styles.statsRow}>
                    <div className={styles.statCard}>
                        <div className={styles.statTitle}><FileText size={14} className={styles.navLink} style={{ display: 'inline', marginRight: 4 }} /> Facturas Procesadas</div>
                        <div className={styles.statValue}>{invoices.length}</div>
                    </div>
                    <div className={styles.statCard}>
                        <div className={styles.statTitle}><Database size={14} className={styles.navLink} style={{ display: 'inline', marginRight: 4 }} /> Monto Total de Facturas</div>
                        <div className={styles.statValue}>
                            {new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(totalAmount)}
                        </div>
                    </div>
                </div>

                <div className={styles.tableContainer}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>Estado</th>
                                <th>Folio</th>
                                <th>Fecha</th>
                                <th>RFC Emisor</th>
                                <th>RFC Receptor</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={6} className={styles.loading}>Conectando a la base de datos...</td>
                                </tr>
                            ) : invoices.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className={styles.loading}>No se encontraron datos CFDI. Sube una carpeta para comenzar.</td>
                                </tr>
                            ) : (
                                invoices.map((inv) => (
                                    <tr key={inv.id}>
                                        <td>
                                            <span className={styles.badge}>
                                                <CheckCircle2 size={12} style={{ marginRight: 4 }} /> Indexado
                                            </span>
                                        </td>
                                        <td>{inv.folio}</td>
                                        <td>{inv.fecha ? new Date(inv.fecha).toLocaleDateString() : 'N/A'}</td>
                                        <td>{inv.emisor_rfc}</td>
                                        <td>{inv.receptor_rfc}</td>
                                        <td style={{ fontWeight: 600 }}>
                                            {new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(inv.total)}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
