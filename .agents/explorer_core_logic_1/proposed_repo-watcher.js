const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const gitSync = require('./git-sync');

const DEBOUNCE_DELAY_MS = 10000; // 10 seconds debounce
const SCAN_INTERVAL_MS = 30000;  // Scan for new repositories every 30 seconds

const activeWatchers = new Map();
const debounceTimers = new Map();

/**
 * Filter function to ignore events on internal folders (like .git, .agents)
 * and the log file itself, to avoid infinite self-triggering loops.
 * 
 * @param {string} relativeFilePath The file path returned by fs.watch
 * @returns {boolean} True if the event should be ignored
 */
function shouldIgnore(relativeFilePath) {
    if (!relativeFilePath) return false;
    const normalized = relativeFilePath.replace(/\\/g, '/');
    
    // Ignore .git and its files
    if (normalized === '.git' || normalized.startsWith('.git/')) return true;
    
    // Ignore agent metadata directory
    if (normalized === '.agents' || normalized.startsWith('.agents/')) return true;
    
    // Ignore log file changes
    if (normalized === 'sync.log' || normalized.endsWith('/sync.log')) return true;
    
    return false;
}

/**
 * Handles fs.watch events. Normalizes paths and implements the 10-second debounce.
 * 
 * @param {string} repoPath The base repository path
 * @param {string} eventType The watch event type (rename or change)
 * @param {string} filename The path of the modified file relative to repoPath
 */
function handleChange(repoPath, eventType, filename) {
    if (shouldIgnore(filename)) {
        return;
    }
    
    logger.info(`[${repoPath}] File change detected: ${eventType} on ${filename || 'unknown file'}`);
    
    if (debounceTimers.has(repoPath)) {
        clearTimeout(debounceTimers.get(repoPath));
    }
    
    const timer = setTimeout(() => {
        debounceTimers.delete(repoPath);
        logger.info(`[${repoPath}] Debounce period expired. Triggering synchronization...`);
        gitSync.triggerSync(repoPath);
    }, DEBOUNCE_DELAY_MS);
    
    debounceTimers.set(repoPath, timer);
}

/**
 * Scans the base directory and its level-1 folders to find Git repositories,
 * dynamically adding or removing watchers.
 * 
 * @param {string} baseDir The directory to scan (e.g., E:\)
 */
function scanAndWatch(baseDir) {
    const currentRepos = new Set();
    
    // Check if baseDir itself is a Git repository
    if (fs.existsSync(path.join(baseDir, '.git'))) {
        currentRepos.add(baseDir);
    }
    
    // Check level-1 directories
    try {
        const files = fs.readdirSync(baseDir, { withFileTypes: true });
        for (const file of files) {
            if (file.isDirectory()) {
                const subDirPath = path.join(baseDir, file.name);
                if (fs.existsSync(path.join(subDirPath, '.git'))) {
                    currentRepos.add(subDirPath);
                }
            }
        }
    } catch (err) {
        logger.error(`Failed to scan base directory ${baseDir}: ${err.message}`);
    }

    // Stop watchers for repositories that no longer exist or are no longer Git repositories
    for (const [watchedPath, watcher] of activeWatchers.entries()) {
        if (!currentRepos.has(watchedPath)) {
            logger.info(`Stopping watcher for: ${watchedPath} (no longer a watched repo)`);
            try {
                watcher.close();
            } catch (err) {
                logger.error(`Error closing watcher for ${watchedPath}: ${err.message}`);
            }
            activeWatchers.delete(watchedPath);
            if (debounceTimers.has(watchedPath)) {
                clearTimeout(debounceTimers.get(watchedPath));
                debounceTimers.delete(watchedPath);
            }
        }
    }

    // Start watchers for newly discovered repositories
    for (const repoPath of currentRepos) {
        if (!activeWatchers.has(repoPath)) {
            logger.info(`Starting watcher for repository: ${repoPath}`);
            try {
                // Native recursive watcher supported on Windows
                const watcher = fs.watch(repoPath, { recursive: true }, (eventType, filename) => {
                    handleChange(repoPath, eventType, filename);
                });
                
                watcher.on('error', (err) => {
                    logger.error(`Watcher encountered an error on ${repoPath}: ${err.message}`);
                    // Close and remove to allow re-initialization during next scan
                    try {
                        watcher.close();
                    } catch (closeErr) {}
                    activeWatchers.delete(repoPath);
                });
                
                activeWatchers.set(repoPath, watcher);
            } catch (err) {
                logger.error(`Failed to initialize watcher for ${repoPath}: ${err.message}`);
            }
        }
    }
}

/**
 * Starts the repository monitoring daemon process.
 * 
 * @param {string} baseDir The directory to monitor (e.g. E:\)
 * @returns {object} Handle containing a stop method to clean up resource subscriptions
 */
function startWatcher(baseDir) {
    logger.info(`Initializing repository watchers under: ${baseDir}`);
    
    // Initial scan and setup
    scanAndWatch(baseDir);
    
    // Setup periodic scanner
    const intervalId = setInterval(() => {
        scanAndWatch(baseDir);
    }, SCAN_INTERVAL_MS);
    
    return {
        stop: () => {
            clearInterval(intervalId);
            for (const [repoPath, watcher] of activeWatchers.entries()) {
                try {
                    watcher.close();
                } catch (err) {}
            }
            activeWatchers.clear();
            for (const timer of debounceTimers.values()) {
                clearTimeout(timer);
            }
            debounceTimers.clear();
            logger.info('All repository watchers and debounce timers stopped.');
        }
    };
}

module.exports = {
    startWatcher
};
