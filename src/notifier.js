const { spawn } = require('child_process');
const logger = require('./logger');

/**
 * Escapes unsafe XML characters.
 */
function escapeXml(unsafe) {
  if (typeof unsafe !== 'string') return '';
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

/**
 * Shows a Windows Toast Notification by executing a PowerShell script in the background.
 */
function showNotification(title, message) {
  // Only execute on Windows platform
  if (process.platform !== 'win32') {
    logger.info(`[Notification Bypassed - Non-Windows] ${title}: ${message}`);
    return;
  }

  // Construct XML template safely in JS
  const xmlPayload = `
<toast>
    <visual>
        <binding template="ToastGeneric">
            <text id="1">${escapeXml(title)}</text>
            <text id="2">${escapeXml(message)}</text>
        </binding>
    </visual>
</toast>
`.trim();

  // Escape single quotes for PowerShell single-quoted literal string
  const escapedXmlPayload = xmlPayload.replace(/'/g, "''");

  const psScript = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

$ToastXml = [Windows.Data.Xml.Dom.XmlDocument]::New()
$ToastXml.LoadXml('${escapedXmlPayload}')
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
