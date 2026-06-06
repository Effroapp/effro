' Effro Launcher
' Double-click to start the app and open it in your browser.
' Place this file in the same folder as docker-compose.yml

Set WshShell = CreateObject("WScript.Shell")
Set fso     = CreateObject("Scripting.FileSystemObject")

' Resolve the project directory relative to this script's location
projectDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Start the Docker container in detached mode (no terminal window)
' This is equivalent to: docker compose up -d
WshShell.Run "cmd /c cd /d """ & projectDir & """ && docker compose up -d", 0, True

' Give the server a few seconds to initialise on first start
WScript.Sleep 4000

' Open the app in the default browser
WshShell.Run "http://localhost:8080"
