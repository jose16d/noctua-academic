' ============================================================================
' Noctua Academic 🦉 - Lanzador Silencioso Portable para Windows
' Abre la aplicación en una ventana nativa de escritorio independiente y
' apaga el servidor Node automáticamente al cerrar la ventana.
' ============================================================================

Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

CurrentDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = CurrentDir

' 1. Asegurar que no haya instancias huérfanas previas en el puerto 3000
WshShell.Run "powershell -NoProfile -Command ""Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }""", 0, True

' 2. Iniciar el servidor Express en segundo plano (oculto, 0 = ocultar ventana)
WshShell.Run "node server.js", 0, False

' 3. Esperar 1.2 segundos a que SQLite y Express inicien
WScript.Sleep 1200

' 4. Buscar navegador compatible para modo App Nativo (Edge o Chrome)
Dim browserCmd, edgePath, chromePath

edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
If Not FSO.FileExists(edgePath) Then
    edgePath = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
End If

chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
If Not FSO.FileExists(chromePath) Then
    chromePath = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
End If

If FSO.FileExists(edgePath) Then
    browserCmd = """" & edgePath & """ --app=http://localhost:3000 --window-size=1280,820 --name=""Noctua Academic"""
ElseIf FSO.FileExists(chromePath) Then
    browserCmd = """" & chromePath & """ --app=http://localhost:3000 --window-size=1280,820 --name=""Noctua Academic"""
Else
    browserCmd = "cmd /c start http://localhost:3000"
End If

' 5. Abrir la ventana de la aplicación de forma síncrona (espera hasta que el usuario cierre la ventana)
WshShell.Run browserCmd, 1, True

' 6. APAGADO AUTOMÁTICO: Al cerrar la ventana, terminar el proceso Node de inmediato para liberar archivos
WshShell.Run "powershell -NoProfile -Command ""Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }""", 0, True
