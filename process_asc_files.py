import pandas as pd
import glob
import os

import argparse

def process_asc_files():
    parser = argparse.ArgumentParser(description="Process .asc files to Excel.")
    parser.add_argument("directory", nargs="?", default=".", help="Directory containing .asc files")
    parser.add_argument("--output", help="Directory to save output files")
    args = parser.parse_args()

    target_dir = args.directory
    
    # Determine output directory
    if args.output:
        output_dir = args.output
    else:
        output_dir = os.path.join(target_dir, "processed_output")
    
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        print(f"Created output directory: {output_dir}")
    else:
        print(f"Using output directory: {output_dir}")
    
    # Find all .asc files recursively in the target directory
    asc_files = []
    # os.walk allows to search recursively
    for root, dirs, files in os.walk(target_dir):
        # Avoid scanning the output directory itself if it's inside target_dir
        if os.path.abspath(root).startswith(os.path.abspath(output_dir)):
            continue
            
        for file in files:
            if file.lower().endswith(".asc"):
                asc_files.append(os.path.join(root, file))
    
    if not asc_files:
        print(f"No .asc files found in {target_dir} or subdirectories.")
        return

    print(f"Found {len(asc_files)} files to process in {target_dir} (recursive).")

    for file_path in asc_files:
        try:
            # Generate output filename in the output directory
            base_name = os.path.splitext(os.path.basename(file_path))[0]
            output_file = os.path.join(output_dir, base_name + ".xlsx")
            print(f"Processing {file_path} -> {output_file}")
            
            # Read the file
            # Assuming headers are in the first row
            # 0xC1 is 'Á' in latin1. Using latin1 is safer for legacy/windows files.
            df = pd.read_csv(file_path, sep='|', dtype=str, encoding='latin1', on_bad_lines='skip')
            
            if df.empty:
                print(f"Skipping empty file: {file_path}")
                continue

            # Clean up column names (strip whitespace)
            df.columns = df.columns.str.strip()
            
            # Define prefixes for dynamic aggregation (Sum)
            # We want to sum columns that look like numeric totals
            sum_prefixes = ['Total', 'Valor', 'Peso', 'Importe', 'Cantidad']
            
            # Identify columns to aggregate
            cols_to_sum = []
            for col in df.columns:
                # Check if column starts with any of the prefixes
                if any(col.startswith(prefix) for prefix in sum_prefixes):
                    cols_to_sum.append(col)
            
            # Additional specific columns requested if not covered by prefixes
            specific_cols = ['TotalFletes', 'TotalSeguros', 'TotalEmbalajes', 
                             'TotalIncrementables', 'TotalDeducibles', 'PesoBrutoMercancia']
            for col in specific_cols:
                if col in df.columns and col not in cols_to_sum:
                    cols_to_sum.append(col)

            # Convert these columns to numeric
            for col in cols_to_sum:
                df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
            
            # Aggregation logic DISABLED per user request to keep all rows.
            # Previously we grouped by ClaveDocumento, but this collapsed details.
            # Now we export the full dataframe with numeric conversions.
            df_final = df
            
            # Export to Excel
            df_final.to_excel(output_file, index=False)
            
        except Exception as e:
            print(f"Error processing {file_path}: {e}")

if __name__ == "__main__":
    process_asc_files()
