const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { syncRepository } = require('./git-sync');

const watchers = new Map();      // repoPath -> FSWatcher instance
const debounceTimers = new Map(); // repoPath -> setTimeout ID
let scanInterval = null;

/**
 * Normalizes and checks if a file change event should be ignored.
 * We ignore:
 * - Changes inside the .git/ folder
 * - Changes inside the .agents/ folder
 * - Changes to the sync.log file itself (to prevent logging loop)
 */
function isIgnored(filename, repoPath) {
  if (!filename) return false;

  // Resolve absolute paths and namespace prefixes to relative paths
  let relativeFilename = filename;
  if (path.isAbsolute(filename) || filename.startsWith('\\\\?\\') || filename.startsWith('//?/')) {
    let cleanFilename = filename;
    if (filename.startsWith('\\\\?\\') || filename.startsWith('//?/')) {
      cleanFilename = filename.substring(4);
    }
    relativeFilename = path.relative(repoPath, cleanFilename);
  }

  // Normalize path separators to forward slashes for uniform checks
  const normalized = relativeFilename.replace(/\\/g, '/');

  // Ignore changes to the repo directory itself
  if (normalized === '' || normalized === '.' || normalized === './') {
    return true;
  }

  // Split path by '/' and check if any segment is '.git', '.agents', or '.sync.lock'
  const segments = normalized.split('/');
  if (segments.includes('.git') || segments.includes('.agents') || segments.includes('.sync.lock')) {
    return true;
  }

  // 3. Ignore changes to the sync.log file itself
  const absolutePath = path.resolve(repoPath, filename);
  const logFileAbsolute = path.resolve(process.env.TEST_LOG_FILE || process.env.SYNC_LOG_PATH || 'E:\\git_auto_sync_service\\sync.log');
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

  const debounceTime = parseInt(process.env.DEBOUNCE_DELAY, 10) || parseInt(process.env.SYNC_DEBOUNCE_MS, 10) || 10000;
  
  const timerId = setTimeout(async () => {
    debounceTimers.delete(repoPath);
    try {
      await syncRepository(repoPath);
    } catch (err) {
      logger.error(`[${path.basename(repoPath)}] Error during execution: ${err.message}`);
    }
  }, debounceTime);

  debounceTimers.set(repoPath, timerId);
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

    // Helper to check if a directory is a Git repository
    const isGitRepo = (dir) => {
      try {
        const gitDir = path.join(dir, '.git');
        return fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory();
      } catch (e) {
        return false;
      }
    };

    // 1. Check if the root baseDir itself is a Git repository
    if (isGitRepo(baseDir)) {
      repos.push(baseDir);
    }

    // 2. Scan level-1 items
    let level1Items;
    try {
      level1Items = fs.readdirSync(baseDir);
    } catch (err) {
      logger.error(`Error listing base directory ${baseDir}: ${err.message}`);
      return repos;
    }

    for (const item of level1Items) {
      const fullPath = path.join(baseDir, item);

      // Ignore Windows system / hidden folders
      if (item === '$RECYCLE.BIN' || item === 'System Volume Information' || item === '.git' || item === '.agents') {
        continue;
      }

      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch (err) {
        continue; // skip unreadable
      }

      if (stat.isDirectory()) {
        // Check if level-1 directory is a Git repo
        if (isGitRepo(fullPath)) {
          repos.push(fullPath);
        } else {
          // 3. Scan inside this level-1 subfolder (level-1 subfolder children)
          let level2Items;
          try {
            level2Items = fs.readdirSync(fullPath);
          } catch (err) {
            continue; // skip unreadable level-1 subdirectory
          }

          for (const subItem of level2Items) {
            const subFullPath = path.join(fullPath, subItem);

            if (subItem === '$RECYCLE.BIN' || subItem === 'System Volume Information' || subItem === '.git' || subItem === '.agents') {
              continue;
            }

            if (isGitRepo(subFullPath)) {
              repos.push(subFullPath);
            }
          }
        }
      }
    }
  } catch (err) {
    logger.error(`Error scanning directories in ${baseDir}: ${err.message}`);
  }

  return repos;
}

/**
 * Dynamic scan updates watchers to add new repos and stop watching removed ones.
 */
function updateWatchers(baseDir) {
  const currentRepos = findGitRepositories(baseDir);

  // 1. Start watching new repositories
  for (const repoPath of currentRepos) {
    if (!watchers.has(repoPath)) {
      startWatchingRepo(repoPath);
    }
  }

  // 2. Stop watching repositories that were removed
  for (const [repoPath, watcher] of watchers) {
    if (!currentRepos.includes(repoPath)) {
      stopWatchingRepo(repoPath);
    }
  }
}

/**
 * Starts watching a single repository.
 */
function startWatchingRepo(repoPath) {
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

    // Initial check on startup: trigger sync only if there are pending local changes (Required by TC-T4-05)
    const { runGit } = require('./git-sync');
    runGit(repoPath, ['status', '--porcelain']).then(({ stdout }) => {
      if (stdout.trim()) {
        logger.info(`[${repoName}] Pending local changes detected on startup. Triggering initial sync.`);
        triggerSync(repoPath);
      }
    }).catch(() => {
      // ignore status errors on startup
    });
  } catch (err) {
    logger.error(`[${repoName}] Failed to start file watcher: ${err.message}`);
  }
}

/**
 * Stops watching a single repository.
 */
function stopWatchingRepo(repoPath) {
  const repoName = path.basename(repoPath);
  const watcher = watchers.get(repoPath);
  if (watcher) {
    try {
      watcher.close();
      logger.info(`[${repoName}] File watcher stopped.`);
    } catch (err) {
      logger.error(`[${repoName}] Failed to close file watcher: ${err.message}`);
    }
    watchers.delete(repoPath);
  }
}

/**
 * Scans and starts watching detected Git repositories, and runs periodic scan.
 */
function watchRepositories(baseDir) {
  logger.info(`Initializing repo watcher on: ${baseDir}`);
  
  // Perform initial scan and start watchers
  updateWatchers(baseDir);

  // Start 30-second periodic scan interval
  scanInterval = setInterval(() => {
    logger.info(`Running periodic 30-second repository scan under ${baseDir}...`);
    updateWatchers(baseDir);
  }, 30000);

  return watchers;
}

/**
 * Stops all active file watchers and intervals.
 */
function stopWatching() {
  logger.info('Stopping all active file watchers...');
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
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
