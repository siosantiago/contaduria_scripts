import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel
from typing import List, Dict, Any
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

# Allow CORS for local dev and Vercel frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MONGO_URL = os.getenv("MONGO_DB_URL")
if not MONGO_URL:
    raise ValueError("MONGO_DB_URL is missing")

# Use Motor for async MongoDB operations
client = AsyncIOMotorClient(MONGO_URL)
db = client["ContaduriaFiles"]
collection = db["pedimentos"]

@app.get("/")
async def root_health_check():
    return {
        "status": "Online",
        "service": "Contaduria Python MongoDB Backend",
        "message": "Send POST requests containing the file payload to /api/upload"
    }

class FileData(BaseModel):
    fileName: str
    data: List[Dict[str, Any]]

class UploadRequest(BaseModel):
    parsedFiles: List[FileData]
    isFirstBatch: bool

@app.post("/api/upload")
async def upload_files(payload: UploadRequest):
    try:
        if payload.isFirstBatch:
            await collection.delete_many({})

        documents_to_insert = []
        excel_export_rows = []

        for file in payload.parsedFiles:
            for raw_row in file.data:
                patente = raw_row.get("Patente") or raw_row.get("SeccionAduanera")
                pedimento = raw_row.get("Pedimento")

                if not patente or not pedimento:
                    continue

                month_year_str = "Unknown"
                date_raw = raw_row.get("FechaPagoReal") or raw_row.get("FechaFacturacion")
                if date_raw:
                    # Very simple grouping logic identical to frontend
                    import datetime
                    try:
                        # Assuming date format is YYYY-MM-DD HH:MM:SS
                        # or something pandas could parse. Since TS sent the raw string,
                        # let's replicate the TS logic: parse as Date and get Month-YYYY
                        from dateutil import parser
                        dt = parser.parse(str(date_raw))
                        month_year_str = dt.strftime("%B-%Y")
                    except:
                        month_year_str = "Unknown"

                clean_row = {k: v for k, v in raw_row.items()}
                clean_row.pop('Patente', None)
                clean_row.pop('Pedimento', None)
                clean_row.pop('SeccionAduanera', None)

                documents_to_insert.append({
                    "month_year": month_year_str,
                    "Patente": str(patente),
                    "Pedimento": str(pedimento),
                    "row_data": clean_row,
                    "source_file": file.fileName
                })

        merged_data = {}
        index_fallback = 0

        global_headers = set()
        for doc in documents_to_insert:
            for k in doc["row_data"].keys():
                global_headers.add(k)

        for doc in documents_to_insert:
            my = doc["month_year"]
            pat = doc["Patente"]
            ped = doc["Pedimento"]
            row = doc["row_data"]

            if my not in merged_data:
                merged_data[my] = {}
            
            key = f"{pat}_{ped}"
            if key not in merged_data[my]:
                merged_data[my][key] = {
                    "Patente": pat,
                    "Pedimento": ped,
                    "Partidas": []
                }

            caso_key = row.get("ComplementoCaso")
            if not caso_key or caso_key == "":
                caso_key = f"P_{index_fallback}"
                index_fallback += 1

            final_row = {}
            for k in global_headers:
                val = row.get(k, "")
                if val not in ["", None]:
                    final_row[k] = val
                else:
                    final_row[k] = ""

            merged_data[my][key]["Partidas"].append({caso_key: final_row})

            excel_row = {
                "Month_Year": my,
                "Patente": pat,
                "Pedimento": ped,
                "ComplementoCaso_Key": caso_key,
                "SourceFile": doc["source_file"]
            }
            excel_row.update(final_row)
            excel_export_rows.append(excel_row)

        final_doc_mongo = {"month_year": {}}
        pedimento_docs_to_insert = []

        for my, groups in merged_data.items():
            pedimentos_list = []
            for k, ped_data in groups.items():
                pedimentos_list.append(ped_data)
                
                pedimento_docs_to_insert.append({
                    "month_year_group": my,
                    "Patente": ped_data["Patente"],
                    "Pedimento": ped_data["Pedimento"],
                    "Partidas": ped_data["Partidas"]
                })
            final_doc_mongo["month_year"][my] = pedimentos_list

        insert_id = None
        if pedimento_docs_to_insert:
            await collection.insert_many(pedimento_docs_to_insert)
            insert_id = "inserted_many"

        return {
            "success": True,
            "insertedId": insert_id,
            "finalJson": final_doc_mongo,
            "flatCsvData": excel_export_rows
        }

    except Exception as e:
        print("Error processing batch:", e)
        raise HTTPException(status_code=500, detail=str(e))
