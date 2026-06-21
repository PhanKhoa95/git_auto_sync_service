const path = require('path');
const logger = require('./logger');
const { watchRepositories, stopWatching } = require('./repo-watcher');

// Support custom root path via environment variables for E2E testing
const BASE_DIR = process.env.TEST_E_DRIVE_PATH || 'E:\\';

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
  
  // Make sure process doesn't exit
  keepAliveInterval.unref(); // unref but it still runs, or omit unref to explicitly keep loop alive
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
  // Log and exit, allowing launcher to restart the process if necessary
  process.exit(1);
});
