const fs = require('fs');
const path = require('path');

const LOG_FILE = 'E:\\git_auto_sync_service\\sync.log';

/**
 * Formats a Date object to YYYY-MM-DD HH:mm:ss format.
 * @param {Date} date 
 * @returns {string}
 */
function formatTimestamp(date = new Date()) {
    const pad = (num) => String(num).padStart(2, '0');
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const min = pad(date.getMinutes());
    const ss = pad(date.getSeconds());
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

/**
 * Appends a formatted log line to the log file.
 * @param {string} level 
 * @param {string} message 
 */
function writeLog(level, message) {
    const timestamp = formatTimestamp();
    const logLine = `[${timestamp}] [${level}] ${message}\n`;
    try {
        const dir = path.dirname(LOG_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.appendFileSync(LOG_FILE, logLine, 'utf8');
        console.log(logLine.trim());
    } catch (err) {
        console.error(`Failed to write to log file: ${err.message}`);
    }
}

module.exports = {
    info: (msg) => writeLog('INFO', msg),
    warn: (msg) => writeLog('WARN', msg),
    error: (msg) => writeLog('ERROR', msg)
};
