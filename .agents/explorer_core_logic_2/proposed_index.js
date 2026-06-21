const logger = require('./logger');
const watcher = require('./repo-watcher');
const gitSync = require('./git-sync');

const BASE_DIR = 'E:\\';
const SCAN_INTERVAL_MS = 30000; // Rescan every 30 seconds to catch new/deleted folders

function main() {
    logger.info('======================================================================');
    logger.info('      STARTING GIT AUTO-SYNC SERVICE DAEMON (AUTOPILOT ACTIVE)        ');
    logger.info(`      Base monitoring directory: ${BASE_DIR}                         `);
    logger.info('======================================================================');
    
    // Set up initial scanning and registration
    try {
        watcher.updateWatchers(BASE_DIR, (repoPath) => {
            gitSync.triggerSync(repoPath);
        });
        
        const watchedList = watcher.getActiveWatchers();
        logger.info(`Initial scan complete. Watching ${watchedList.length} Git repositories:`);
        watchedList.forEach(repo => logger.info(` - Path: ${repo}`));
    } catch (err) {
        logger.error(`Fatal error during service initialization scan: ${err.message}`);
    }
    
    // Periodically query directory structure to react to added or removed repositories
    const intervalId = setInterval(() => {
        try {
            watcher.updateWatchers(BASE_DIR, (repoPath) => {
                gitSync.triggerSync(repoPath);
            });
        } catch (err) {
            logger.error(`Error during dynamic monitoring update: ${err.message}`);
        }
    }, SCAN_INTERVAL_MS);
    
    // Ensure cleanup is executed on exit signals
    const shutdown = (signal) => {
        logger.info(`Received ${signal}. Gracefully stopping daemon...`);
        clearInterval(intervalId);
        
        const active = watcher.getActiveWatchers();
        active.forEach(repo => watcher.stopWatching(repo));
        
        logger.info('Cleanup complete. Exit process.');
        process.exit(0);
    };
    
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
    // Process error boundary triggers to guarantee daemon robustness
    process.on('uncaughtException', (err) => {
        logger.error(`Uncaught Exception detected: ${err.message}\n${err.stack}`);
        // Let the daemon continue running instead of exiting.
    });
    
    process.on('unhandledRejection', (reason, promise) => {
        logger.error(`Unhandled Promise Rejection at: ${promise}, reason: ${reason}`);
    });
    
    logger.info('Daemon is active and listening for file modifications...');
}

main();
