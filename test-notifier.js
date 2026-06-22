const { spawn } = require('child_process');

const title = 'Test Title JS';
const message = 'Test Message JS';
const escapedTitle = title.replace(/`/g, '``').replace(/"/g, '`"');
const escapedMessage = message.replace(/`/g, '``').replace(/"/g, '`"');

const psScript = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

$ToastTemplate = @"
<toast>
    <visual>
        <binding template="ToastGeneric">
            <text id="1">${escapedTitle}</text>
            <text id="2">${escapedMessage}</text>
        </binding>
    </visual>
</toast>
"@

$ToastXml = [Windows.Data.Xml.Dom.XmlDocument]::New()
$ToastXml.LoadXml($ToastTemplate)
$ToastMessage = [Windows.UI.Notifications.ToastNotification]::New($ToastXml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("PowerShell").Show($ToastMessage)
`;

console.log('Spawning powershell...');
const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
  stdio: 'pipe',
  windowsHide: true
});

child.stdout.on('data', (data) => {
  console.log(`STDOUT: ${data.toString()}`);
});

child.stderr.on('data', (data) => {
  console.error(`STDERR: ${data.toString()}`);
});

child.on('close', (code) => {
  console.log(`Process exited with code ${code}`);
});

child.stdin.write(psScript);
child.stdin.end();
