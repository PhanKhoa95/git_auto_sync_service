const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { watchRepositories, stopWatching } = require('./repo-watcher');

// Base directory configurable via env, defaulting to 'E:\'
const BASE_DIR = process.env.TEST_E_DRIVE_PATH || 'E:\\';
const lockFilePath = path.join(BASE_DIR, '.sync.lock');

/**
 * Acquires lock on the base directory to prevent concurrent daemon execution.
 */
function acquireLock() {
  try {
    if (fs.existsSync(lockFilePath)) {
      const existingPid = parseInt(fs.readFileSync(lockFilePath, 'utf8').trim(), 10);
      if (existingPid) {
        try {
          process.kill(existingPid, 0);
          // Process is still running, abort startup
          logger.error(`Another daemon instance with PID ${existingPid} is already running. Exiting.`);
          process.exit(1);
        } catch (e) {
          if (e.code === 'ESRCH') {
            // Process is not running, lock is stale, we can remove it
            logger.warn(`Stale lock file found for PID ${existingPid}. Removing it.`);
            try { fs.unlinkSync(lockFilePath); } catch (err) {}
          } else {
            // Process is likely running but we do not have permission or another error occurred.
            // Exit immediately and do not delete the lock file.
            logger.error(`Another daemon instance with PID ${existingPid} is running (kill error: ${e.code || e.message}). Exiting.`);
            process.exit(1);
          }
        }
      }
    }

    // Atomically create the lock file
    fs.writeFileSync(lockFilePath, process.pid.toString(), { flag: 'wx', encoding: 'utf8' });
    
    // Register lock cleanup on exit
    const cleanup = () => {
      try {
        if (fs.existsSync(lockFilePath)) {
          const ownerPid = parseInt(fs.readFileSync(lockFilePath, 'utf8').trim(), 10);
          if (ownerPid === process.pid) {
            fs.unlinkSync(lockFilePath);
          }
        }
      } catch (e) {}
    };

    process.on('exit', cleanup);
  } catch (err) {
    logger.error(`Failed to acquire startup lock: ${err.message}. Exiting.`);
    process.exit(1);
  }
}

// Acquire lock before proceeding
acquireLock();

logger.info(`==================================================`);
logger.info(`Git Auto-Sync Service Daemon Starting`);
logger.info(`==================================================`);
logger.info(`PID: ${process.pid}`);
logger.info(`Node version: ${process.version}`);
logger.info(`Operating System: ${process.platform} (${process.arch})`);
logger.info(`Monitoring Root: ${BASE_DIR}`);
logger.info(`==================================================`);

// Scan and watch repositories
const watchers = watchRepositories(BASE_DIR);

if (watchers.size === 0) {
  logger.warn('No active Git repositories were detected initially.');
  logger.warn('The daemon will remain active in the background and check for changes.');
  
  // Keep the event loop alive if no watchers are active
  const keepAliveInterval = setInterval(() => {
    logger.debug('Daemon heartbeat check - no repositories currently watched.');
  }, 300000); // 5 minutes heartbeat
  
  // Make sure process doesn't exit by keeping the interval unreferenced or referenced.
  // Leaving it referenced ensures the process stays alive even if there are no file watchers.
}

// Graceful shutdown registration
function handleShutdown(signal) {
  logger.info(`Received ${signal}. Shutting down daemon gracefully...`);
  stopWatching();
  logger.info('Daemon stopped.');
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled Promise Rejection: ${reason}`);
});

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error.message}\nStack: ${error.stack}`);
  // Log and exit with error code, allowing launcher/daemon tools to restart if configured
  process.exit(1);
});
