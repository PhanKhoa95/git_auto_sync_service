Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

currentDir = fso.GetParentFolderName(WScript.ScriptFullName)
watchdogJsPath = fso.BuildPath(currentDir, "src\watchdog.js")

cmd1 = "node """ & watchdogJsPath & """"
WScript.Echo "Running: " & cmd1

On Error Resume Next
errCode = WshShell.Run(cmd1, 0, True)
If Err.Number <> 0 Then
    WScript.Echo "VBScript Err Number: " & Err.Number
    WScript.Echo "VBScript Err Description: " & Err.Description
Else
    WScript.Echo "Exit Code: " & errCode
End If
On Error GoTo 0
