Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\difns\OneDrive\바탕 화면\완성프로그램\AI-News-Trend-Studio"
WshShell.Run "cmd /c attrib -U /S /D * >nul 2>&1 & npm start", 0, False
