[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

$ToastTemplate = @"
<toast>
    <visual>
        <binding template="ToastGeneric">
            <text id="1">Test Title</text>
            <text id="2">Test Message from script file</text>
        </binding>
    </visual>
</toast>
"@

try {
  $ToastXml = [Windows.Data.Xml.Dom.XmlDocument]::New()
  $ToastXml.LoadXml($ToastTemplate)
  $ToastMessage = [Windows.UI.Notifications.ToastNotification]::New($ToastXml)
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("PowerShell").Show($ToastMessage)
  Write-Host "SUCCESS: Toast shown"
} catch {
  Write-Error $_
}
