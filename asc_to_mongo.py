import os
import sys
import argparse
import pandas as pd
import json
import subprocess
from pymongo import MongoClient
from dotenv import load_dotenv

def get_files_mac():
    script = '''
    set myFiles to choose file with prompt "Select .asc files to process" with multiple selections allowed
    set posixFiles to {}
    repeat with aFile in myFiles
        set end of posixFiles to POSIX path of aFile
    end repeat
    set AppleScript's text item delimiters to "\\n"
    return posixFiles as text
    '''
    try:
        out = subprocess.check_output(['osascript', '-e', script]).decode('utf-8').strip()
        if not out:
            return []
        return out.split('\n')
    except subprocess.CalledProcessError:
        return []

def get_save_mac(prompt, default_name):
    script = f'''
    set myFile to choose file name with prompt "{prompt}" default name "{default_name}"
    return POSIX path of myFile
    '''
    try:
        out = subprocess.check_output(['osascript', '-e', script]).decode('utf-8').strip()
        return out
    except subprocess.CalledProcessError:
        return None

def show_alert_mac(title, message):
    script = f'display dialog "{message}" with title "{title}" buttons {{"OK"}} default button "OK"'
    try:
        subprocess.run(['osascript', '-e', script])
    except:
        pass

def process_asc_to_mongo():
    parser = argparse.ArgumentParser(description="Process .asc files and push to MongoDB interactively.")
    parser.add_argument("--db", default="ContaduriaFiles", help="MongoDB database name")
    parser.add_argument("--collection", default="pedimentos", help="MongoDB collection name")
    args = parser.parse_args()

    print("Opening file selection dialog...")
    file_paths = get_files_mac()
    
    if not file_paths:
        print("No files selected. Exiting.")
        sys.exit(0)
    
    asc_files = list(file_paths)
    print(f"Selected {len(asc_files)} files to process.")

    load_dotenv()
    mongo_url = os.environ.get("MONGO_DB_URL")
    if not mongo_url:
        print("Error: MONGO_DB_URL not found in environment variables. .env is missing or variable is unset.")
        show_alert_mac("Error", "MONGO_DB_URL not found in environment variables.")
        sys.exit(1)

    print("Connecting to MongoDB...")
    try:
        client = MongoClient(mongo_url)
        db = client[args.db]
        collection = db[args.collection]
        client.admin.command('ping')
        
        print(f"Cleaning the current data in the collection {args.db}.{args.collection}...")
        collection.delete_many({})
        print("Current data cleared.")
    except Exception as e:
        print(f"Failed to connect to MongoDB: {e}")
        show_alert_mac("Error", f"Failed to connect to MongoDB: {e}")
        sys.exit(1)

    documents_to_insert = []
    excel_export_rows = []

    for file_path in asc_files:
        print(f"Processing {os.path.basename(file_path)}...")
        try:
            df = pd.read_csv(file_path, sep='|', encoding='latin-1', dtype=str, on_bad_lines='skip')
            
            if df.empty:
                continue

            cols = [c.strip().replace('\ufeff', '') for c in df.columns.astype(str)]
            df.columns = cols
            
            if 'Pedimento' not in df.columns or 'Patente' not in df.columns:
                print(f"Warning: File {file_path} lacks Pedimento or Patente. Skipping.")
                continue
                
            # The user requested to physically flip the data in the Patente and Pedimento columns
            df['Patente_temp'] = df['Patente']
            df['Patente'] = df['Pedimento']
            df['Pedimento'] = df['Patente_temp']
            df.drop(columns=['Patente_temp'], inplace=True)

            numeric_prefixes = ['Total', 'Valor', 'Peso', 'Importe', 'Cantidad']
            specific_cols = ['TotalFletes', 'TotalSeguros', 'TotalEmbalajes', 
                             'TotalIncrementables', 'TotalDeducibles', 'PesoBrutoMercancia', 'PrecioUnitario']
            
            for col in df.columns:
                if any(col.startswith(p) for p in numeric_prefixes) or col in specific_cols:
                    df[col] = pd.to_numeric(df[col].astype(str).str.replace(',', ''), errors='coerce').fillna(0)

            date_col = None
            if 'FechaPagoReal' in df.columns:
                date_col = 'FechaPagoReal'
            elif 'FechaFacturacion' in df.columns:
                date_col = 'FechaFacturacion'
            
            if date_col:
                df['month_year'] = pd.to_datetime(df[date_col], errors='coerce').dt.strftime('%B-%Y')
                df['month_year'] = df['month_year'].fillna('Unknown')
            else:
                df['month_year'] = 'Unknown'

            for (month_year, patente, pedimento), group in df.groupby(['month_year', 'Patente', 'Pedimento'], dropna=False):
                if pd.isna(patente) and pd.isna(pedimento):
                    continue
                
                group_no_keys = group.drop(columns=['Patente', 'Pedimento', 'month_year'], errors='ignore')
                partidas = group_no_keys.to_dict(orient='records')
                
                partidas_list = []
                index_fallback = 0
                for p in partidas:
                    clean_p = {k: v for k, v in p.items() if pd.notna(v) and v != 'nan' and v != ''}
                    caso_key = clean_p.get('ComplementoCaso')
                    if not caso_key or pd.isna(caso_key):
                        caso_key = f"P_{index_fallback}"
                        index_fallback += 1
                    
                    partidas_list.append({str(caso_key): clean_p})
                    
                    excel_row = {
                        "Month_Year": month_year,
                        "Patente": patente,
                        "Pedimento": pedimento,
                        "ComplementoCaso_Key": caso_key,
                        "SourceFile": os.path.basename(file_path)
                    }
                    excel_row.update(clean_p)
                    excel_export_rows.append(excel_row)

                doc = {
                    "month_year": str(month_year),
                    "Patente": str(patente),
                    "Pedimento": str(pedimento),
                    "partidas": partidas_list,
                }
                documents_to_insert.append(doc)

        except Exception as e:
            print(f"Error processing {file_path}: {e}")

    merged_data = {}
    for doc in documents_to_insert:
        my = doc["month_year"]
        k = (doc["Patente"], doc["Pedimento"])
        
        if my not in merged_data:
            merged_data[my] = {}
        
        if k not in merged_data[my]:
            merged_data[my][k] = {
                "Patente": doc["Patente"],
                "Pedimento": doc["Pedimento"],
                "Partidas": []
            }
            
        merged_data[my][k]["Partidas"].extend(doc["partidas"])

    final_doc_mongo = {
        "month_year": {}
    }
    
    for my, my_pedimentos in merged_data.items():
        pedimentos_list = []
        for k, v in my_pedimentos.items():
            pedimentos_list.append({
                "Patente": v["Patente"],
                "Pedimento": v["Pedimento"],
                "Partidas": v["Partidas"]
            })
        final_doc_mongo["month_year"][str(my)] = pedimentos_list

    if not final_doc_mongo["month_year"]:
        print("No valid documents generated.")
        show_alert_mac("Done", "No valid data to import/export.")
        return

    try:
        print("Pushing the final grouped document into MongoDB...")
        result = collection.insert_one(final_doc_mongo)
        print(f"Successfully inserted ONE main document to {args.db}.{args.collection}. ID: {result.inserted_id}")
    except Exception as e:
        print(f"Failed to insert document: {e}")
        show_alert_mac("Error", f"Failed to push to MongoDB: {e}")

    # Ask to save JSON natively
    json_path = get_save_mac("Save JSON Export As", "export_pedimentos.json")
    if json_path:
        with open(json_path, 'w', encoding='utf-8') as f:
            export_doc = dict(final_doc_mongo)
            if "_id" in export_doc:
                export_doc.pop("_id")
            json.dump(export_doc, f, ensure_ascii=False, indent=4)
        print(f"Saved JSON export to {json_path}")
        
    # As Excel files are slow, export as CSV (which opens perfectly and instantaneously in Excel!)
    csv_path = get_save_mac("Save CSV Export As (opens instantly in Excel!)", "export_pedimentos.csv")
    if csv_path:
        df_export = pd.DataFrame(excel_export_rows)
        cols = df_export.columns.tolist()
        priority_cols = ['Month_Year', 'Patente', 'Pedimento', 'ComplementoCaso_Key', 'SourceFile']
        for c in priority_cols:
            if c in cols:
                cols.remove(c)
        df_export = df_export[priority_cols + cols]
        
        try:
            # utf-8-sig ensures Excel parses special characters like accents perfectly!
            df_export.to_csv(csv_path, index=False, encoding='utf-8-sig')
            print(f"Saved instantaneous CSV export to {csv_path}")
        except Exception as e:
            print(f"Failed to save CSV: {e}")
            show_alert_mac("Error", f"Could not save CSV file: {e}")
            
    show_alert_mac("Success", "Processing Complete!\\n\\nAll data has been wiped and replaced in MongoDB.\\nFiles exported locally if paths were provided.")

if __name__ == "__main__":
    process_asc_to_mongo()
