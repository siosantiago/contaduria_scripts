import pandas as pd
import os

def verify_output():
    file_path = "test_data.xlsx"
    if not os.path.exists(file_path):
        print(f"FAILED: {file_path} not found.")
        return

    df = pd.read_excel(file_path)
    
    # Test Data:
    # ClaveDocumento|Name|Date|TotalFletes|TotalSeguros|TotalEmbalajes|TotalIncrementables|TotalDeducibles|PesoBrutoMercancia|TipoCambio|ExtraCol
    # 1001|Doc 1 Part 1|2023-01-01|10.5|5.0|1.0|2.0|0.0|100.0|20.5|A
    # 1001|Doc 1 Part 2|2023-01-01|20.0|5.0|1.0|2.0|0.0|50.0|20.5|B
    # 1002|Doc 2 Only|2023-01-02|100.0|10.0|0.0|0.0|5.0|200.0|19.8|C
    
    row_1001 = df[df['ClaveDocumento'] == 1001].iloc[0]
    
    # Check explicitly requested columns
    expected_fletes = 30.5
    if abs(expected_fletes - row_1001['TotalFletes']) < 0.001:
        print(f"PASS: TotalFletes correct ({row_1001['TotalFletes']})")
    else:
        print(f"FAIL: TotalFletes mismatch. Expected {expected_fletes}, got {row_1001['TotalFletes']}")

    # Check implied dynamic column 'TotalSeguros'
    expected_seguros = 10.0 # 5.0 + 5.0
    if abs(expected_seguros - row_1001['TotalSeguros']) < 0.001:
        print(f"PASS: TotalSeguros (dynamic) correct ({row_1001['TotalSeguros']})")
    else:
        print(f"FAIL: TotalSeguros mismatch. Expected {expected_seguros}, got {row_1001['TotalSeguros']}")

    # Check non-aggregated column preservation
    if row_1001['TipoCambio'] == 20.5:
        print("PASS: TipoCambio preserved correctly.")
    else:
        print(f"FAIL: TipoCambio mismatch. Got {row_1001['TipoCambio']}")

if __name__ == "__main__":
    verify_output()
