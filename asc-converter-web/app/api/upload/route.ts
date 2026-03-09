import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import path from 'path';

let cachedClient: MongoClient | null = null;

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { parsedFiles, isFirstBatch } = body;

        // Load .env from parent directory where the python script used to run
        dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
        const mongoUrl = process.env.MONGO_DB_URL;

        // Connect to MongoDB
        if (!mongoUrl) {
            return NextResponse.json({ error: 'Falta configurar MONGO_DB_URL en el archivo .env (../.env)' }, { status: 400 });
        }

        if (!cachedClient) {
            cachedClient = new MongoClient(mongoUrl);
            await cachedClient.connect();
        }

        const db = cachedClient.db('ContaduriaFiles');
        const collection = db.collection('pedimentos');

        // Clean current data only on the VERY FIRST batch
        if (isFirstBatch) {
            await collection.deleteMany({});
        }

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

            // Drop undefined/empty
            const finalRow: any = {};
            Object.keys(row).forEach(k => {
                if (row[k] !== '' && row[k] !== null && row[k] !== undefined) {
                    finalRow[k] = row[k];
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

        // Build the final mega document
        const finalDocMongo: any = { month_year: {} };
        for (const my of Object.keys(mergedData)) {
            const pedimentosList = [];
            for (const k of Object.keys(mergedData[my])) {
                pedimentosList.push(mergedData[my][k]);
            }
            finalDocMongo.month_year[my] = pedimentosList;
        }

        let insertId = null;
        if (Object.keys(finalDocMongo.month_year).length > 0) {
            const result = await collection.insertOne(finalDocMongo);
            insertId = result.insertedId;
        }

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
