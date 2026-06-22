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

/**
 * Translates a raw Git error message into a user-friendly, actionable description.
 */
function showGitErrorNotification(repoName, action, rawError) {
  const rawLower = (rawError || '').toLowerCase();
  let title = `Lỗi đồng bộ [${repoName}]`;
  let message = `Đã xảy ra lỗi khi thực hiện ${action}.`;

  if ((rawLower.includes('permission to') && rawLower.includes('denied to')) || rawLower.includes('error: 403') || rawLower.includes('403 forbidden')) {
    title = `Lỗi xác thực GitHub [${repoName}]`;
    message = `Tài khoản GitHub hiện tại không có quyền ghi. Hãy mở PowerShell tại thư mục này và chạy lệnh 'git push' để đăng nhập lại.`;
  } else if (rawLower.includes('please tell me who you are') || rawLower.includes('user.name') || rawLower.includes('user.email')) {
    title = `Chưa cấu hình Git [${repoName}]`;
    message = `Git chưa cấu hình tên/email. Hãy thiết lập cấu hình Git (git config --global user.name/email) để tự động commit.`;
  } else if (rawLower.includes('conflict') || rawLower.includes('merge failed') || rawLower.includes('automatic merge failed')) {
    title = `Xung đột mã nguồn [${repoName}]`;
    message = `Có thay đổi trùng lặp trên GitHub. Hãy mở Web Dashboard hoặc trình soạn thảo mã nguồn để giải quyết xung đột.`;
  } else if (rawLower.includes('detached head')) {
    title = `Lỗi trạng thái Git [${repoName}]`;
    message = `Dự án đang ở trạng thái Detached HEAD. Hãy chuyển sang một nhánh hợp lệ (ví dụ: main hoặc master).`;
  } else if (rawLower.includes('could not resolve host') || rawLower.includes('network is unreachable') || rawLower.includes('connection timed out')) {
    title = `Mất kết nối mạng [${repoName}]`;
    message = `Không thể kết nối đến máy chủ GitHub. Tiến trình sẽ tự động thử lại khi có mạng.`;
  } else if (rawLower.includes('dubious ownership') || rawLower.includes('safe.directory')) {
    title = `Lỗi bảo mật thư mục Git [${repoName}]`;
    message = `Git phát hiện quyền sở hữu không khớp. Hãy mở terminal và chạy lệnh 'git config --global --add safe.directory <đường_dẫn_dự_án>'.`;
  } else {
    // Fallback: Clean up the error to show only the first few lines of useful text
    const cleanLines = (rawError || '')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('Command failed:'))
      .slice(0, 2);
    if (cleanLines.length > 0) {
      message = `Lỗi khi ${action}: ${cleanLines.join(' | ')}`;
    }
  }

  showNotification(title, message);
}

module.exports = { showNotification, showGitErrorNotification };
