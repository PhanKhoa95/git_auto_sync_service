Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get the directory where this script is located
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Build the absolute path to src/watchdog.js
watchdogJsPath = fso.BuildPath(currentDir, "src\watchdog.js")

' Try to locate node.exe in common locations or use the PATH
nodePath = "node"
If fso.FileExists("C:\Program Files\nodejs\node.exe") Then
    nodePath = """C:\Program Files\nodejs\node.exe"""
End If

' Build command line
cmd = nodePath & " """ & watchdogJsPath & """"
' Run the command windowless (0 = hide window, False = don't wait for execution to finish)
WshShell.Run cmd, 0, False


