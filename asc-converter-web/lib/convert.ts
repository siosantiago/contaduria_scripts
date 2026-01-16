import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export interface ProcessedData {
    fileName: string;
    data: any[];
    headers: string[];
}

export async function processAscFile(file: File): Promise<ProcessedData> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (event) => {
            try {
                const arrayBuffer = event.target?.result as ArrayBuffer;
                // Use windows-1252 (Latin1) to handle the 0xC1 (Á) and other special characters
                const decoder = new TextDecoder('windows-1252');
                const text = decoder.decode(arrayBuffer);

                Papa.parse(text, {
                    delimiter: '|',
                    header: true,
                    skipEmptyLines: 'greedy',
                    transformHeader: (header) => header.trim(),
                    complete: (results) => {
                        let data = results.data as any[];
                        const headers = results.meta.fields || [];

                        // Define prefixes for dynamic numeric conversion
                        const numericPrefixes = ['Total', 'Valor', 'Peso', 'Importe', 'Cantidad'];
                        const specificCols = ['TotalFletes', 'TotalSeguros', 'TotalEmbalajes',
                            'TotalIncrementables', 'TotalDeducibles', 'PesoBrutoMercancia'];

                        // Convert columns to numeric
                        data = data.map(row => {
                            const newRow = { ...row };
                            headers.forEach(col => {
                                const isNumericCol = numericPrefixes.some(p => col.startsWith(p)) || specificCols.includes(col);
                                if (isNumericCol) {
                                    const val = String(newRow[col] || '0').replace(/,/g, '');
                                    newRow[col] = parseFloat(val) || 0;
                                }
                            });
                            return newRow;
                        });

                        resolve({
                            fileName: file.name.replace(/\.asc$/i, '.xlsx'),
                            data,
                            headers
                        });
                    },
                    error: (error: Error) => reject(error)
                });
            } catch (err) {
                reject(err);
            }
        };

        reader.onerror = (error) => reject(error);
        reader.readAsArrayBuffer(file);
    });
}

export function downloadExcel(processed: ProcessedData) {
    const worksheet = XLSX.utils.json_to_sheet(processed.data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Datos');
    XLSX.writeFile(workbook, processed.fileName);
}
