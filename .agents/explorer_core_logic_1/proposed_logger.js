const fs = require('fs');
const path = require('path');

const LOG_FILE = 'E:\\git_auto_sync_service\\sync.log';

/**
 * Appends a formatted message to the sync.log file and outputs it to the console.
 * Includes error handling to prevent the daemon from crashing if logging fails.
 * 
 * @param {string} message The message to log
 * @param {string} level The log level (INFO, WARN, ERROR)
 */
function log(message, level = 'INFO') {
    const pad = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const logLine = `[${timestamp}] [${level}] ${message}\n`;
    
    try {
        const dir = path.dirname(LOG_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.appendFileSync(LOG_FILE, logLine, 'utf8');
    } catch (err) {
        console.error(`Failed to write to log file: ${err.message}`);
    }
    
    console.log(logLine.trim());
}

module.exports = {
    info: (msg) => log(msg, 'INFO'),
    warn: (msg) => log(msg, 'WARN'),
    error: (msg) => log(msg, 'ERROR')
};
