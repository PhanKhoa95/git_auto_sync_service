const fs = require('fs');
const path = require('path');

// Allow configuration via environment variables for testing purposes
const LOG_FILE = process.env.TEST_LOG_FILE || process.env.SYNC_LOG_PATH || path.join(__dirname, '..', 'sync.log');

function formatMessage(level, message) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  return `[${timestamp}] [${level}] ${message}\n`;
}

function writeLog(level, message) {
  const formatted = formatMessage(level, message);
  
  // Output to standard output/error streams for daemon console monitoring
  if (level === 'ERROR') {
    process.stderr.write(formatted);
  } else {
    process.stdout.write(formatted);
  }

  try {
    // Ensure parent directory exists recursively
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(LOG_FILE, formatted, 'utf8');
  } catch (err) {
    process.stderr.write(`[LOGGER ERROR] Failed to write to log file: ${err.message}\n`);
  }
}

module.exports = {
  info: (msg) => writeLog('INFO', msg),
  warn: (msg) => writeLog('WARN', msg),
  error: (msg) => writeLog('ERROR', msg),
  debug: (msg) => {
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      writeLog('DEBUG', msg);
    }
  },
  getLogFilePath: () => LOG_FILE
};
