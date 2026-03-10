import { NextResponse } from 'next/server';
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { parsedFiles, isFirstBatch } = body;

        // Processing the records exactly like Python script
        const documentsToInsert: any[] = [];
        const excelExportRows: any[] = [];

        for (const file of parsedFiles) {
            const { fileName, data } = file;

            for (const rawRow of data) {
                // Find Patente and Pedimento (handle fallback)
                let patente = rawRow['Patente'] || rawRow['SeccionAduanera'];
                let pedimento = rawRow['Pedimento'];

                if (!patente || !pedimento) {
                    continue; // skip rows without both
                }

                // Date extraction
                let monthYearStr = 'Unknown';
                const dateRaw = rawRow['FechaPagoReal'] || rawRow['FechaFacturacion'];
                if (dateRaw) {
                    const d = new Date(dateRaw);
                    if (!isNaN(d.getTime())) {
                        // format %B-%Y equivalent
                        const formatter = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
                        monthYearStr = formatter.format(d).replace(' ', '-');
                    }
                }

                // Clean out grouping keys
                const cleanRow = { ...rawRow };
                delete cleanRow['Patente'];
                delete cleanRow['Pedimento'];
                delete cleanRow['SeccionAduanera'];

                documentsToInsert.push({
                    month_year: monthYearStr,
                    Patente: String(patente),
                    Pedimento: String(pedimento),
                    row_data: cleanRow,
                    source_file: fileName
                });
            }
        }

        // Aggregate exactly like python merged_data
        const mergedData: any = {};
        let indexFallback = 0;

        // Extract all universal headers across all files
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

            // Normalize row to include ALL global headers (even if empty)
            const finalRow: any = {};
            globalHeaders.forEach(k => {
                const val = row[k];
                if (val !== '' && val !== null && val !== undefined) {
                    finalRow[k] = val;
                } else {
                    finalRow[k] = ''; // Ensure column is created even if file didn't have it
                }
            });

            mergedData[my][key].Partidas.push({
                [casoKey]: finalRow
            });

            // Prepare excel export array
            const excelRow = {
                Month_Year: my,
                Patente: pat,
                Pedimento: ped,
                ComplementoCaso_Key: casoKey,
                SourceFile: doc.source_file,
                ...finalRow
            };
            excelExportRows.push(excelRow);
        }

        // Build the final mega document for JSON download
        const finalDocMongo: any = { month_year: {} };
        const pedimentoDocsToInsert: any[] = [];

        for (const my of Object.keys(mergedData)) {
            const pedimentosList = [];
            for (const k of Object.keys(mergedData[my])) {
                const pedData = mergedData[my][k];
                pedimentosList.push(pedData);

                // Add to flat list for MongoDB insertion
                pedimentoDocsToInsert.push({
                    month_year_group: my,
                    Patente: pedData.Patente,
                    Pedimento: pedData.Pedimento,
                    Partidas: pedData.Partidas
                });
            }
            finalDocMongo.month_year[my] = pedimentosList;
        }

        let insertId = 'no-db';

        return NextResponse.json({
            success: true,
            insertedId: insertId,
            finalJson: finalDocMongo,
            flatCsvData: excelExportRows
        });

    } catch (error: any) {
        console.error("API error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
