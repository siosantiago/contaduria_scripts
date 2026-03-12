"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, UploadCloud, FileText, Database, CheckCircle2, ChevronDown, ChevronUp, Trash2, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { supabase } from "../../lib/supabase";
import styles from "./page.module.css";

interface Invoice {
    id: string;
    source_file: string;
    emisor_rfc: string;
    emisor_nombre: string;
    receptor_rfc: string;
    receptor_nombre: string;
    subtotal: string;
    descuento: string;
    total: string;
    moneda: string;
    tipo_cambio: string;
    version: string;
    serie: string;
    folio: string;
    fecha: string;
    sello: string;
    forma_pago: string;
    no_certificado: string;
    certificado: string;
    tipo_de_comprobante: string;
    exportacion: string;
    metodo_pago: string;
    lugar_expedicion: string;
    sello_sat: string;
    created_at: string;
};

type UploadResult = {
    id: string;
    date: Date;
    totalFiles: number;
    inserted: number;
    errors: any[];
};

export default function CfdiDashboard() {
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [uploadHistory, setUploadHistory] = useState<UploadResult[]>([]);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [authError, setAuthError] = useState("");
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(0);
    const [totalCount, setTotalCount] = useState(0);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);
    const PAGE_SIZE = 100;

    const checkSession = useCallback(async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                setIsAuthenticated(true);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        checkSession();
    }, [checkSession]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setAuthError("");
        setLoading(true);
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error) {
            setAuthError(error.message);
        } else {
            setIsAuthenticated(true);
        }
        setLoading(false);
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        setIsAuthenticated(false);
    };

    const deleteHistory = async (id: string) => {
        if (!confirm("¿Estás seguro de que quieres eliminar este registro de historial?")) return;
        
        try {
            const { error } = await supabase
                .from("upload_history")
                .delete()
                .eq("id", id);
            
            if (error) throw error;
            setUploadHistory(prev => prev.filter(item => item.id !== id));
        } catch (err) {
            console.error("Error deleting history:", err);
            alert("No se pudo eliminar el historial.");
        }
    };

    const fetchInvoices = useCallback(async (page: number = 0, query: string = "") => {
        try {
            setLoading(true);
            const from = page * PAGE_SIZE;
            const to = from + PAGE_SIZE - 1;

            let baseQuery = supabase.from("invoices").select("*", { count: "exact" });

            if (query.trim()) {
                const q = `%${query.trim()}%`;
                baseQuery = baseQuery.or(
                    [
                        "emisor_rfc", "emisor_nombre", "receptor_rfc", "receptor_nombre",
                        "folio", "serie", "forma_pago", "metodo_pago", "lugar_expedicion",
                        "source_file", "id", "moneda", "tipo_de_comprobante"
                    ].map(col => `${col}.ilike.${q}`).join(",")
                );
            }

            const { data, error, count } = await baseQuery
                .order("created_at", { ascending: false })
                .range(from, to);

            if (error) throw error;
            setInvoices(data || []);
            setTotalCount(count ?? 0);
        } catch (err) {
            console.error("Error fetching invoices:", err);
        } finally {
            setLoading(false);
        }
    }, [PAGE_SIZE]);

    const fetchHistory = useCallback(async () => {
        try {
            const { data, error } = await supabase
                .from("upload_history")
                .select("*")
                .order("created_at", { ascending: false })
                .limit(20);

            if (error) throw error;
            
            const historyFormatted: UploadResult[] = (data || []).map(row => ({
                id: row.id,
                date: new Date(row.created_at),
                totalFiles: row.total_files,
                inserted: row.inserted,
                errors: row.errors || []
            }));
            setUploadHistory(historyFormatted);
        } catch (err) {
            console.error("Error fetching upload history:", err);
        }
    }, []);

    useEffect(() => {
        if (isAuthenticated) {
            fetchHistory();
        }
    }, [isAuthenticated, fetchHistory]);

    useEffect(() => {
        if (isAuthenticated) {
            fetchInvoices(currentPage, searchQuery);
        }
    }, [isAuthenticated, currentPage, searchQuery]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setCurrentPage(0);
        setSearchQuery(searchInput);
    };

    const handleSearchClear = () => {
        setSearchInput("");
        setCurrentPage(0);
        setSearchQuery("");
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const files = Array.from(e.target.files).filter(f => f.name.toLowerCase().endsWith(".xml"));
        if (files.length === 0) {
            alert("No XML files found in the selected folder.");
            return;
        }

        setUploading(true);
        setProgress(0);
        
        // Fetch current user and session
        const { data: { session } = {} } = await supabase.auth.getSession();
        const owner_id = session?.user?.id || null;
        const access_token = session?.access_token || null;

        const BATCH_SIZE = 50;
        const totalBatches = Math.ceil(files.length / BATCH_SIZE);
        let totalInserted = 0;
        let totalErrors = 0;
        let allErrors: any[] = [];

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
                // Sanitize URL: Remove trailing slashes and common mistake prefixes like /api/upload
                const rawUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
                const backendUrl = rawUrl.replace(/\/api\/upload\/?$/, "").replace(/\/$/, "");
                
                const res = await fetch(`${backendUrl}/api/upload-xml`, {
                    method: "POST",
                    headers: { 
                        "Content-Type": "application/json",
                        "X-API-Key": process.env.NEXT_PUBLIC_API_KEY || "dev_secret"
                    },
                    body: JSON.stringify({ files: batchData, owner_id, access_token })
                });

                if (!res.ok) {
                    const errorText = await res.text();
                    console.error("Batch error:", errorText);
                    totalErrors += batchData.length;
                    allErrors.push({ file: "Backend Error", error: errorText || "Unknown backend error" });
                } else {
                    const data = await res.json();
                    totalInserted += data.inserted || 0;
                    if (data.errors && data.errors.length > 0) {
                        totalErrors += data.errors.length;
                        allErrors = [...allErrors, ...data.errors];
                        console.warn("Backend Insertion Errors:", data.errors);
                    }
                }

                setProgress(Math.round(((i + 1) / totalBatches) * 100));
            }

            // Save to Database
            if (owner_id) {
                const { data: newHistoryRow, error: historyErr } = await supabase
                    .from("upload_history")
                    .insert({
                        total_files: files.length,
                        inserted: totalInserted,
                        errors: allErrors,
                        owner_id: owner_id
                    })
                    .select()
                    .single();

                if (!historyErr && newHistoryRow) {
                    const newResult: UploadResult = {
                        id: newHistoryRow.id,
                        date: new Date(newHistoryRow.created_at),
                        totalFiles: newHistoryRow.total_files,
                        inserted: newHistoryRow.inserted,
                        errors: newHistoryRow.errors || []
                    };
                    setUploadHistory(prev => [newResult, ...prev]);
                } else {
                    console.error("Failed to save history:", historyErr);
                }
            }

            setCurrentPage(0);
            setSearchQuery("");
            setSearchInput("");
            await fetchInvoices(0, ""); // Refresh the list
            if (totalErrors > 0) {
                alert(`Subida completada con advertencias: ${totalInserted} facturas insertadas, ${totalErrors} errores. Revisa la consola para más detalles.`);
            } else {
                alert(`¡Subida completada excitósamente! ${totalInserted} facturas indexadas.`);
            }
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

    if (!isAuthenticated) {
        return (
            <div className={styles.container} style={{ justifyContent: 'center' }}>
                <div className={styles.dashboardCard} style={{ maxWidth: 400, textAlign: 'center', padding: '40px 30px' }}>
                    <h2 style={{ marginBottom: 15, color: '#111827' }}>Acceso Requerido</h2>
                    <p style={{ color: '#6b7280', marginBottom: 30, fontSize: 14 }}>
                        Por favor, inicie sesión con su cuenta para acceder al Dashboard de Facturas.
                    </p>
                    {authError && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '10px', borderRadius: '8px', marginBottom: '20px', fontSize: '14px' }}>{authError}</div>}
                    <form onSubmit={handleLogin}>
                        <input 
                            type="email" 
                            placeholder="Email..." 
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className={styles.passwordInput}
                            required
                        />
                        <input 
                            type="password" 
                            placeholder="Contraseña..." 
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className={styles.passwordInput}
                            required
                        />
                        <button type="submit" className={styles.passwordButton} disabled={loading}>
                            {loading ? "Verificando..." : "Iniciar Sesión"}
                        </button>
                    </form>
                    <Link href="/" className={styles.navLink} style={{ marginTop: 20, display: 'inline-flex' }}>
                        <ArrowLeft size={16} /> Volver al Convertidor ASC
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.dashboardCard}>
                <header className={styles.header}>
                    <div>
                        <Link href="/" className={styles.navLink} style={{ marginBottom: 10 }}>
                            <ArrowLeft size={16} /> Volver
                        </Link>
                        <h1>Dashboard de Facturas CFDI</h1>
                    </div>
                    <div>
                        <button onClick={handleLogout} className={styles.passwordButton} style={{ padding: '8px 16px', background: '#4b5563', width: 'auto' }}>
                            Cerrar Sesión
                        </button>
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
                        style={{ display: 'none' }}
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
                        <div className={styles.statValue}>{totalCount.toLocaleString()}</div>
                    </div>
                    <div className={styles.statCard}>
                        <div className={styles.statTitle}><Database size={14} className={styles.navLink} style={{ display: 'inline', marginRight: 4 }} /> Monto Total de Facturas</div>
                        <div className={styles.statValue}>
                            {new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(totalAmount)}
                        </div>
                    </div>
                </div>

                {/* Search Bar */}
                <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                        <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} />
                        <input
                            type="text"
                            placeholder="Buscar por RFC, nombre, folio, archivo..."
                            value={searchInput}
                            onChange={e => setSearchInput(e.target.value)}
                            style={{ width: '100%', paddingLeft: 34, paddingRight: 12, paddingTop: 8, paddingBottom: 8, border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                        />
                    </div>
                    <button type="submit" className={styles.passwordButton} style={{ width: 'auto', padding: '8px 18px', margin: 0 }}>Buscar</button>
                    {searchQuery && (
                        <button type="button" onClick={handleSearchClear} style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, background: '#f9fafb', cursor: 'pointer', fontSize: 13, color: '#6b7280' }}>
                            Limpiar
                        </button>
                    )}
                </form>

                <div className={styles.tableContainer}>
                    {loading ? (
                        <div className={styles.loading}>Conectando a la base de datos...</div>
                    ) : invoices.length === 0 ? (
                        <div className={styles.loading}>{searchQuery ? `No se encontraron resultados para "${searchQuery}".` : "No se encontraron datos CFDI. Sube una carpeta para comenzar."}</div>
                    ) : (
                        <div className={styles.tableWrapper}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        {/* Basic Identification */}
                                        <th>Fecha (CFDI)</th>
                                        <th>Folio</th>
                                        <th>Serie</th>
                                        <th>UUID</th>
                                        
                                        {/* Emisor */}
                                        <th>RFC Emisor</th>
                                        <th>Nombre Emisor</th>
                                        
                                        {/* Receptor */}
                                        <th>RFC Receptor</th>
                                        <th>Nombre Receptor</th>
                                        
                                        {/* Financials */}
                                        <th>Subtotal</th>
                                        <th>Descuento</th>
                                        <th>Total</th>
                                        <th>Moneda</th>
                                        <th>Tipo Cambio</th>
                                        
                                        {/* Details */}
                                        <th>Forma Pago</th>
                                        <th>Método Pago</th>
                                        <th>V.</th>
                                        <th>Tipo Comprobante</th>
                                        <th>Exportación</th>
                                        <th>Lugar Expedición</th>
                                        <th>No. Certificado</th>
                                        <th>Certificado</th>
                                        <th>Sello</th>
                                        <th>Sello SAT</th>
                                        <th>Archivo</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {invoices.map((inv) => (
                                        <tr key={inv.id}>
                                            <td>{inv.fecha ? new Date(inv.fecha).toLocaleDateString() : "-"}</td>
                                            <td>{inv.folio || "-"}</td>
                                            <td>{inv.serie || "-"}</td>
                                            <td style={{ fontSize: 10, fontFamily: 'monospace' }}>{inv.id}</td>
                                            
                                            <td>{inv.emisor_rfc}</td>
                                            <td>{inv.emisor_nombre}</td>
                                            
                                            <td>{inv.receptor_rfc}</td>
                                            <td>{inv.receptor_nombre}</td>
                                            
                                            <td style={{ fontWeight: 600 }}>${parseFloat(inv.subtotal || "0").toLocaleString()}</td>
                                            <td style={{ color: '#dc2626' }}>${parseFloat(inv.descuento || "0").toLocaleString()}</td>
                                            <td style={{ fontWeight: 600, color: '#10b981' }}>${parseFloat(inv.total || "0").toLocaleString()}</td>
                                            <td>{inv.moneda}</td>
                                            <td>{inv.tipo_cambio}</td>
                                            
                                            <td>{inv.forma_pago}</td>
                                            <td>{inv.metodo_pago}</td>
                                            <td>{inv.version}</td>
                                            <td>{inv.tipo_de_comprobante}</td>
                                            <td>{inv.exportacion}</td>
                                            <td>{inv.lugar_expedicion}</td>
                                            <td>{inv.no_certificado}</td>
                                            <td className={styles.truncateCell} title={inv.certificado}>{inv.certificado ? `${inv.certificado.substring(0, 10)}...` : "-"}</td>
                                            <td className={styles.truncateCell} title={inv.sello}>{inv.sello ? `${inv.sello.substring(0, 10)}...` : "-"}</td>
                                            <td className={styles.truncateCell} title={inv.sello_sat}>{inv.sello_sat ? `${inv.sello_sat.substring(0, 10)}...` : "-"}</td>
                                            <td style={{ fontSize: 11, color: '#6b7280' }}>{inv.source_file}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Pagination */}
                {totalCount > PAGE_SIZE && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, fontSize: 14, color: '#4b5563' }}>
                        <span>
                            Mostrando {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, totalCount)} de {totalCount.toLocaleString()} facturas
                            {searchQuery && ` para "${searchQuery}"`}
                        </span>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button
                                onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                                disabled={currentPage === 0}
                                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: 8, background: currentPage === 0 ? '#f3f4f6' : '#fff', cursor: currentPage === 0 ? 'not-allowed' : 'pointer', color: currentPage === 0 ? '#9ca3af' : '#111827' }}
                            >
                                <ChevronLeft size={16} /> Anterior
                            </button>
                            <span style={{ padding: '6px 12px', background: '#f3f4f6', borderRadius: 8, fontWeight: 600 }}>
                                {currentPage + 1} / {Math.ceil(totalCount / PAGE_SIZE)}
                            </span>
                            <button
                                onClick={() => setCurrentPage(p => p + 1)}
                                disabled={(currentPage + 1) * PAGE_SIZE >= totalCount}
                                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: 8, background: (currentPage + 1) * PAGE_SIZE >= totalCount ? '#f3f4f6' : '#fff', cursor: (currentPage + 1) * PAGE_SIZE >= totalCount ? 'not-allowed' : 'pointer', color: (currentPage + 1) * PAGE_SIZE >= totalCount ? '#9ca3af' : '#111827' }}
                            >
                                Siguiente <ChevronRight size={16} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Upload History Section */}
            {uploadHistory.length > 0 && (
                <div className={styles.dashboardCard} style={{ marginTop: 30 }}>
                    <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--primary)', marginBottom: 20 }}>Historial de Subidas Anteriores</h2>
                    <div className={styles.historyList}>
                        {uploadHistory.map(result => (
                            <div key={result.id} className={styles.historyCard}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                                    <span style={{ fontWeight: 600, color: '#111827' }}>
                                        {result.date.toLocaleString()}
                                    </span>
                                    {result.errors.length > 0 ? (
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                            <span className={styles.badge} style={{ background: '#fee2e2', color: '#991b1b' }}>
                                                ⚠️ {result.errors.length} Errores
                                            </span>
                                            <button 
                                                onClick={() => deleteHistory(result.id)}
                                                className={styles.deleteBtn}
                                                title="Eliminar historial"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                            <span className={styles.badge}>
                                                ✅ Completado
                                            </span>
                                            <button 
                                                onClick={() => deleteHistory(result.id)}
                                                className={styles.deleteBtn}
                                                title="Eliminar historial"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <div style={{ fontSize: 14, color: '#4b5563', marginBottom: result.errors.length > 0 ? 12 : 0 }}>
                                    Archivos procesados: <b>{result.totalFiles}</b> | Insertados: <b>{result.inserted}</b>
                                </div>
                                
                                {result.errors.length > 0 && (
                                    <div className={styles.errorsWrapper}>
                                        <button 
                                            className={styles.accordionHeader}
                                            onClick={() => setExpandedHistoryId(expandedHistoryId === result.id ? null : result.id)}
                                        >
                                            Ver detalles de errores
                                            {expandedHistoryId === result.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                        </button>
                                        
                                        {expandedHistoryId === result.id && (
                                            <div className={styles.errorsContainer} style={{ marginTop: 10 }}>
                                                <ul style={{ fontSize: 12, margin: 0, paddingLeft: 16, color: '#b91c1c' }}>
                                                    {result.errors.slice(0, 20).map((err, idx) => (
                                                        <li key={idx} style={{ marginBottom: 4 }}>
                                                            {err.file && <strong>{err.file}: </strong>}
                                                            {err.error && typeof err.error === 'string' ? err.error : JSON.stringify(err.error || err)}
                                                        </li>
                                                    ))}
                                                </ul>
                                                {result.errors.length > 20 && (
                                                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
                                                        ...y {result.errors.length - 20} errores más. (Revisa la consola para el log completo)
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
