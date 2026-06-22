const { spawn } = require('child_process');
const logger = require('./logger');

/**
 * Shows a Windows Toast Notification by executing a PowerShell script in the background.
 */
function showNotification(title, message) {
  // Only execute on Windows platform
  if (process.platform !== 'win32') {
    logger.info(`[Notification Bypassed - Non-Windows] ${title}: ${message}`);
    return;
  }

  // Escape backticks and double quotes in PowerShell
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

  try {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
      stdio: 'pipe',
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        logger.error(`PowerShell notification process exited with code ${code}. Title: "${title}". Message: "${message}". Stdout: ${stdout.trim()}. Stderr: ${stderr.trim()}`);
      } else {
        logger.debug(`Notification successfully triggered via PowerShell: ${title}`);
      }
    });

    child.on('error', (err) => {
      logger.error(`Failed to spawn PowerShell for notification: ${err.message}`);
    });

    child.stdin.write(psScript);
    child.stdin.end();
  } catch (err) {
    logger.error(`Error triggering notification: ${err.message}`);
  }
}

module.exports = { showNotification };
