import pandas as pd
import os
import io

file_name = '1766810_551.txt'

# Check if the file exists before trying to read it
if not os.path.exists(file_name):
    print(f"Error: The file '{file_name}' was not found.")
    print("Please make sure the file is in the same folder as this script.")
else:
    tried = []
    encodings_to_try = ['utf-8', 'utf-8-sig', 'utf-16', 'cp1252', 'latin-1']
    df = None

    for enc in encodings_to_try:
        try:
            df = pd.read_csv(file_name, sep='|', encoding=enc, on_bad_lines='skip')
            print(f"Successfully read the file '{file_name}' using encoding: {enc}")
            break
        except UnicodeDecodeError:
            tried.append(enc)
        except pd.errors.ParserError as e:
            print(f"ParserError with encoding {enc}: {e}")
            tried.append(enc)
        except Exception as e:
            print(f"Other error with encoding {enc}: {e}")
            tried.append(enc)

    if df is None:
        # Fallback: read as binary and decode with latin-1 (lossless single-byte)
        try:
            with open(file_name, 'rb') as f:
                raw = f.read()
            text = raw.decode('latin-1', errors='replace')
            df = pd.read_csv(io.StringIO(text), sep='|', on_bad_lines='skip')
            print(f"Read file by decoding bytes with latin-1 (errors replaced).")
        except Exception as e:
            print("Failed to read the file with all fallbacks.")
            print("Tried encodings:", tried)
            print("Last error:", e)
            df = None

    if df is not None:
        # Normalizar nombres de columna: eliminar BOM, espacios y corregir variantes
        cols = [c.strip().replace('\ufeff', '') for c in df.columns.astype(str)]
        df.columns = cols
        # corregir variantes típicas
        if 'atente' in df.columns:
            df = df.rename(columns={'atente': 'Patente'})
        if 'patente' in df.columns:
            df = df.rename(columns={'patente': 'Patente'})
        # Asegurarse que existen Pedimento y PrecioUnitario
        if 'Pedimento' not in df.columns or 'PrecioUnitario' not in df.columns:
            print("El archivo no contiene las columnas 'Pedimento' y/o 'PrecioUnitario'. Columnas encontradas:", list(df.columns))
        else:
            # Asegurar que PrecioUnitario es numérico
            df['PrecioUnitario'] = pd.to_numeric(df['PrecioUnitario'], errors='coerce').fillna(0)

            # 1) Agregar suma de PrecioUnitario por Pedimento
            suma = df.groupby('Pedimento', as_index=False)['PrecioUnitario'].sum()

            # 2) Tomar la primera fila por Pedimento para conservar el resto de columnas
            primeras = df.drop_duplicates(subset=['Pedimento']).set_index('Pedimento')

            # 3) Reemplazar PrecioUnitario en esas primeras filas por la suma calculada
            primeras.loc[suma['Pedimento'], 'PrecioUnitario'] = suma.set_index('Pedimento')['PrecioUnitario']

            # Resultado final: una fila por Pedimento que conserva las demás columnas
            df_final = primeras.reset_index()

            # Guardar un archivo Excel con 3 hojas: original, agregado (solo Pedimento+Precio), final (filas únicas con suma)
            out_xlsx = os.path.splitext(file_name)[0] + '_with_aggregation.xlsx'
            with pd.ExcelWriter(out_xlsx, engine='openpyxl') as writer:
                df.to_excel(writer, sheet_name='original', index=False)
                suma.to_excel(writer, sheet_name='agregado', index=False)
                df_final.to_excel(writer, sheet_name='final', index=False)

            print(f"Archivo Excel con hojas 'original','agregado' y 'final' guardado en: {out_xlsx}")

            # También guardar CSV si lo deseas
            out_csv = os.path.splitext(file_name)[0] + '_final.csv'
            df_final.to_csv(out_csv, index=False, encoding='utf-8')
            print(f"CSV final guardado en: {out_csv}")

