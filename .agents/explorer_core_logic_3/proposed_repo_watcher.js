const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { syncRepository } = require('./git-sync');

const watchers = new Map();      // repoPath -> FSWatcher instance
const debounceTimers = new Map(); // repoPath -> setTimeout ID
const activeSyncs = new Set();    // repoPath -> boolean (true if currently syncing)
const pendingSyncs = new Set();   // repoPath -> boolean (true if changes occurred during active sync)

/**
 * Normalizes and checks if a file change event should be ignored.
 * We ignore:
 * - Changes inside the .git/ folder
 * - Changes to the sync.log file itself (to prevent logging loop)
 */
function isIgnored(filename, repoPath) {
  if (!filename) return false;

  // Normalize path separators to forward slashes for uniform checks
  const normalized = filename.replace(/\\/g, '/');

  // 1. Ignore changes inside the .git directory
  if (normalized.startsWith('.git/') || normalized === '.git') {
    return true;
  }

  // 2. Ignore changes to the sync.log file itself
  const absolutePath = path.resolve(repoPath, filename);
  const logFileAbsolute = path.resolve(process.env.SYNC_LOG_PATH || path.join('E:', 'git_auto_sync_service', 'sync.log'));
  if (absolutePath === logFileAbsolute) {
    return true;
  }

  return false;
}

/**
 * Triggers sync with a 10-second debounce mechanism.
 */
function triggerSync(repoPath) {
  if (debounceTimers.has(repoPath)) {
    clearTimeout(debounceTimers.get(repoPath));
  }

  const debounceTime = parseInt(process.env.SYNC_DEBOUNCE_MS, 10) || 10000;
  
  const timerId = setTimeout(async () => {
    debounceTimers.delete(repoPath);
    await executeSync(repoPath);
  }, debounceTime);

  debounceTimers.set(repoPath, timerId);
}

/**
 * Executes the sync process, ensuring no concurrent sync runs on the same repository.
 */
async function executeSync(repoPath) {
  if (activeSyncs.has(repoPath)) {
    // Mark as pending so we re-run after the current sync completes
    pendingSyncs.add(repoPath);
    logger.info(`[${path.basename(repoPath)}] Sync already in progress. Enqueuing subsequent sync.`);
    return;
  }

  activeSyncs.add(repoPath);
  try {
    await syncRepository(repoPath);
  } catch (err) {
    logger.error(`[${path.basename(repoPath)}] Error during execution: ${err.message}`);
  } finally {
    activeSyncs.delete(repoPath);

    // If modifications occurred during the active sync, schedule another run
    if (pendingSyncs.has(repoPath)) {
      pendingSyncs.delete(repoPath);
      logger.info(`[${path.basename(repoPath)}] Running pending sync after previous cycle completion.`);
      // Add a small safety delay (1 second) before restarting the cycle
      setTimeout(() => executeSync(repoPath), 1000);
    }
  }
}

/**
 * Scans the base directory and its level-1 children for Git repositories.
 */
function findGitRepositories(baseDir) {
  const repos = [];

  try {
    if (!fs.existsSync(baseDir)) {
      logger.warn(`Base directory does not exist: ${baseDir}`);
      return repos;
    }

    // Check if the root itself is a Git repository
    const baseGitDir = path.join(baseDir, '.git');
    if (fs.existsSync(baseGitDir) && fs.statSync(baseGitDir).isDirectory()) {
      repos.push(baseDir);
    }

    // Scan level-1 subdirectories
    const files = fs.readdirSync(baseDir);
    for (const file of files) {
      const fullPath = path.join(baseDir, file);

      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          // Ignore typical system / hidden folders on Windows
          if (file === '$RECYCLE.BIN' || file === 'System Volume Information' || file === '.git') {
            continue;
          }

          const gitDir = path.join(fullPath, '.git');
          if (fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory()) {
            repos.push(fullPath);
          }
        }
      } catch (err) {
        logger.debug(`Could not access directory ${fullPath}: ${err.message}`);
      }
    }
  } catch (err) {
    logger.error(`Error scanning directories in ${baseDir}: ${err.message}`);
  }

  return repos;
}

/**
 * Scans and starts watching detected Git repositories.
 */
function watchRepositories(baseDir) {
  const repos = findGitRepositories(baseDir);
  logger.info(`Found ${repos.length} Git repositories under ${baseDir}`);

  for (const repoPath of repos) {
    const repoName = path.basename(repoPath);
    try {
      logger.info(`[${repoName}] Setting up recursive file watcher...`);
      
      const watcher = fs.watch(repoPath, { recursive: true }, (eventType, filename) => {
        if (isIgnored(filename, repoPath)) {
          return;
        }
        logger.info(`[${repoName}] File system change detected: "${filename}" (event: ${eventType})`);
        triggerSync(repoPath);
      });

      watcher.on('error', (err) => {
        logger.error(`[${repoName}] File watcher error: ${err.message}`);
      });

      watchers.set(repoPath, watcher);
    } catch (err) {
      logger.error(`[${repoName}] Failed to start file watcher: ${err.message}`);
    }
  }

  return watchers;
}

/**
 * Stops all active file watchers.
 */
function stopWatching() {
  logger.info('Stopping all active file watchers...');
  for (const [repoPath, watcher] of watchers) {
    const repoName = path.basename(repoPath);
    try {
      watcher.close();
      logger.info(`[${repoName}] File watcher stopped.`);
    } catch (err) {
      logger.error(`[${repoName}] Failed to close file watcher: ${err.message}`);
    }
  }
  watchers.clear();
}

module.exports = {
  watchRepositories,
  stopWatching,
  isIgnored,
  findGitRepositories
};
