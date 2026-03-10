import os
import uuid
import datetime
import xmltodict
from supabase import create_client, Client
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

# --- Supabase Setup ---
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

supabase_client: Optional[Client] = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
        print("Supabase client initialized successfully.")
    except Exception as e:
        print(f"Failed to initialize Supabase client: {e}")
# ----------------------# Allow CORS for local dev and Vercel frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

        insert_id = "no-db"

        return {
            "success": True,
            "insertedId": insert_id,
            "finalJson": final_doc_mongo,
            "flatCsvData": excel_export_rows
        }

    except Exception as e:
        print("Error processing batch:", e)
        raise HTTPException(status_code=500, detail=str(e))

# --- XML to Supabase Upload Endpoint ---

class XmlFileData(BaseModel):
    fileName: str
    content: str

class UploadXmlRequest(BaseModel):
    files: List[XmlFileData]

@app.post("/api/upload-xml")
async def upload_xml_files(payload: UploadXmlRequest):
    if not supabase_client:
        raise HTTPException(status_code=500, detail="Supabase client not configured or missing SUPABASE_URL / SUPABASE_KEY")

    inserted_count = 0
    errors = []
    
    # Optional: We can insert in batches if payload is huge
    rows_to_insert = []

    for file_data in payload.files:
        try:
            # Parse XML to dictionary
            xml_dict = xmltodict.parse(file_data.content)
            
            # The root is usually <cfdi:Comprobante>
            comprobante = xml_dict.get("cfdi:Comprobante", {})
            if not comprobante:
                errors.append({"file": file_data.fileName, "error": "No cfdi:Comprobante root element found."})
                continue
            
            # Extract fields handling variations (some keys use @ prefix due to xmltodict parsing attributes)
            folio = comprobante.get("@Folio", "")
            fecha = comprobante.get("@Fecha", None)
            total = comprobante.get("@Total", 0)
            
            # Handle Emisor and Receptor blocks
            emisor = comprobante.get("cfdi:Emisor", {})
            emisor_rfc = emisor.get("@Rfc", "")
            emisor_nombre = emisor.get("@Nombre", "")
            
            receptor = comprobante.get("cfdi:Receptor", {})
            receptor_rfc = receptor.get("@Rfc", "")
            receptor_nombre = receptor.get("@Nombre", "")
            
            row = {
                "id": str(uuid.uuid4()),
                "source_file": file_data.fileName,
                "folio": folio,
                "fecha": fecha if fecha else None,
                "emisor_rfc": emisor_rfc,
                "emisor_nombre": emisor_nombre,
                "receptor_rfc": receptor_rfc,
                "receptor_nombre": receptor_nombre,
                "total": float(total) if total else 0.0,
                "raw_data": xml_dict  # the complete parsed JSON structure
            }
            rows_to_insert.append(row)
            
        except Exception as e:
            errors.append({"file": file_data.fileName, "error": str(e)})

    # Insert into Supabase table "invoices" in chunks of 100 to avoid request size limits
    chunk_size = 100
    for i in range(0, len(rows_to_insert), chunk_size):
        chunk = rows_to_insert[i:i + chunk_size]
        try:
            res = supabase_client.table("invoices").insert(chunk).execute()
            inserted_count += len(chunk)
        except Exception as e:
            errors.append({"error": f"Failed inserting chunk {i}-{i+chunk_size}: {str(e)}"})

    return {
        "success": True,
        "processed": len(payload.files),
        "inserted": inserted_count,
        "errors": errors
    }
