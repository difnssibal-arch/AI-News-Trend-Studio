Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\difns\OneDrive\???~1\???~1\AI-NEW~2"
WshShell.Run "cmd /c attrib -U /S /D * >nul 2>&1 & npm start", 0, False
