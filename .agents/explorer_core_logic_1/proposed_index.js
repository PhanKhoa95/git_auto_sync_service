const logger = require('./logger');
const repoWatcher = require('./repo-watcher');

const MONITOR_BASE_DIR = 'E:\\';

/**
 * Main entry point for the Git Auto-Sync Service daemon.
 * Sets up global exception handlers and keeps the process running.
 */
function main() {
    logger.info('==================================================');
    logger.info('   Starting Git Auto-Sync Service Daemon           ');
    logger.info('==================================================');
    logger.info(`Monitoring target base directory: ${MONITOR_BASE_DIR}`);

    try {
        const watcherHandle = repoWatcher.startWatcher(MONITOR_BASE_DIR);

        // Register termination signal listeners for clean resource disposal
        process.on('SIGINT', () => {
            logger.info('SIGINT received. Disposing resources and exiting...');
            watcherHandle.stop();
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            logger.info('SIGTERM received. Disposing resources and exiting...');
            watcherHandle.stop();
            process.exit(0);
        });

        // Uncaught exceptions handler to prevent service crashes
        process.on('uncaughtException', (err) => {
            logger.error(`Uncaught Exception in daemon process: ${err.message}\nStack: ${err.stack}`);
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error(`Unhandled Promise Rejection at: ${promise}, reason: ${reason}`);
        });

        // Periodic log output to demonstrate that the daemon is alive
        setInterval(() => {
            logger.info('Daemon heartbeat check: Service is operational.');
        }, 3600000); // Logs every 1 hour

    } catch (err) {
        logger.error(`Fatal crash during daemon startup: ${err.message}`);
        process.exit(1);
    }
}

main();
