const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const watchers = new Map();       // repoPath -> fs.FSWatcher
const debounceTimers = new Map(); // repoPath -> NodeJS.Timeout

/**
 * Checks if the changed file path is internal to Git (e.g. inside .git folder).
 * We split by system separators to avoid checking nested files that contain ".git" in their name.
 * @param {string} filename 
 * @returns {boolean}
 */
function isGitInternal(filename) {
    if (!filename) return false;
    const segments = filename.split(/[\\/]/);
    return segments.includes('.git');
}

/**
 * Scans baseDir and its level-1 subfolders to detect all active Git repositories.
 * Safe from permission/access errors.
 * @param {string} baseDir 
 * @returns {string[]} List of directory absolute paths that represent Git repositories.
 */
function getGitRepositories(baseDir) {
    const repos = [];
    
    // Check if baseDir itself is a Git repository
    try {
        const rootGit = path.join(baseDir, '.git');
        if (fs.existsSync(rootGit) && fs.statSync(rootGit).isDirectory()) {
            repos.push(baseDir);
        }
    } catch (err) {
        // Safe to ignore access/permission errors
    }
    
    // Check level-1 subfolders
    try {
        const items = fs.readdirSync(baseDir, { withFileTypes: true });
        for (const item of items) {
            if (item.isDirectory()) {
                const subDir = path.join(baseDir, item.name);
                const gitDir = path.join(subDir, '.git');
                try {
                    if (fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory()) {
                        repos.push(subDir);
                    }
                } catch (err) {
                    // Safe to ignore access/permission errors (e.g. System Volume Information)
                }
            }
        }
    } catch (err) {
        // Safe to ignore base directory read errors
    }
    
    return repos;
}

/**
 * Starts watching a single Git repository recursively using Node's native fs.watch.
 * Implements a 10-second debounce mechanism.
 * @param {string} repoPath 
 * @param {function} onSyncTrigger Callback when sync is triggered
 */
function watchRepository(repoPath, onSyncTrigger) {
    if (watchers.has(repoPath)) return;
    
    try {
        logger.info(`Starting recursive file system watch on: ${repoPath}`);
        
        const watcher = fs.watch(repoPath, { recursive: true }, (eventType, filename) => {
            // Ignore files inside .git metadata folder to prevent infinite sync loops
            if (isGitInternal(filename)) {
                return;
            }
            
            logger.info(`[Watcher] Change detected in ${repoPath}: ${filename || 'unidentified file'} (${eventType})`);
            
            // Debounce for 10 seconds
            if (debounceTimers.has(repoPath)) {
                clearTimeout(debounceTimers.get(repoPath));
            }
            
            const timer = setTimeout(() => {
                debounceTimers.delete(repoPath);
                logger.info(`[Watcher] Debounce complete (10s) for ${repoPath}. Requesting synchronization...`);
                onSyncTrigger(repoPath);
            }, 10000); // 10,000 milliseconds = 10 seconds
            
            debounceTimers.set(repoPath, timer);
        });
        
        watcher.on('error', (err) => {
            logger.error(`[Watcher] Watcher error on repository ${repoPath}: ${err.message}`);
            stopWatching(repoPath);
        });
        
        watchers.set(repoPath, watcher);
    } catch (err) {
        logger.error(`[Watcher] Failed to initialize watcher on ${repoPath}: ${err.message}`);
    }
}

/**
 * Stops watching a repository and clears its debounce timers.
 * @param {string} repoPath 
 */
function stopWatching(repoPath) {
    if (watchers.has(repoPath)) {
        try {
            watchers.get(repoPath).close();
        } catch (err) {
            // Ignore close error
        }
        watchers.delete(repoPath);
        logger.info(`Stopped watching repository: ${repoPath}`);
    }
    if (debounceTimers.has(repoPath)) {
        clearTimeout(debounceTimers.get(repoPath));
        debounceTimers.delete(repoPath);
    }
}

/**
 * Scans the base directory to align watchers with existing Git projects.
 * Automatically handles adding new repositories and removing deleted/un-git'ed repositories.
 * @param {string} baseDir 
 * @param {function} onSyncTrigger 
 */
function updateWatchers(baseDir, onSyncTrigger) {
    const currentRepos = getGitRepositories(baseDir);
    
    // 1. Remove watchers for directories that are no longer valid Git repositories
    for (const watchedPath of watchers.keys()) {
        if (!currentRepos.includes(watchedPath)) {
            stopWatching(watchedPath);
        }
    }
    
    // 2. Add watchers for newly detected Git repositories
    for (const repoPath of currentRepos) {
        if (!watchers.has(repoPath)) {
            watchRepository(repoPath, onSyncTrigger);
        }
    }
}

/**
 * Returns an array of paths that are currently being watched.
 * @returns {string[]}
 */
function getActiveWatchers() {
    return Array.from(watchers.keys());
}

module.exports = {
    updateWatchers,
    getActiveWatchers,
    stopWatching
};
