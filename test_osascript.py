import subprocess
script = """
set myFiles to choose file with prompt "Select .asc files" with multiple selections allowed
set posixFiles to {}
repeat with aFile in myFiles
    set end of posixFiles to POSIX path of aFile
end repeat
set AppleScript's text item delimiters to "\\n"
return posixFiles as text
"""
try:
    out = subprocess.check_output(['osascript', '-e', script]).decode('utf-8').strip()
    print("OUT:")
    print(out)
except subprocess.CalledProcessError as e:
    print("CANCELLED OR ERROR:", e)
