const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { syncRepository } = require('./git-sync');
const { getConfig } = require('./config-manager');

const watchers = new Map();      // repoPath -> FSWatcher instance
const debounceTimers = new Map(); // repoPath -> setTimeout ID
let scanInterval = null;
let lastScanTime = Date.now();

/**
 * Normalizes and checks if a file change event should be ignored.
 */
function isIgnored(filename, repoPath) {
  if (!filename) return true; // Ignore null filenames to prevent infinite watcher loops on Windows

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

  // Split path by '/' and check if any segment matches ignored patterns
  const segments = normalized.split('/');
  const config = getConfig();
  const ignoredPatterns = config.ignoredPatterns || ['.git', '.agents', '.sync.lock'];
  
  if (segments.some(segment => ignoredPatterns.includes(segment) || segment === '.sync.lock')) {
    return true;
  }

  // Ignore changes to the sync.log file itself
  const absolutePath = path.resolve(repoPath, filename);
  const logFileAbsolute = path.resolve(process.env.TEST_LOG_FILE || process.env.SYNC_LOG_PATH || 'E:\\git_auto_sync_service\\sync.log');
  if (absolutePath === logFileAbsolute) {
    return true;
  }

  return false;
}

/**
 * Triggers sync with a configurable debounce mechanism.
 */
function triggerSync(repoPath) {
  if (debounceTimers.has(repoPath)) {
    clearTimeout(debounceTimers.get(repoPath));
  }

  const config = getConfig();
  const debounceTime = config.debounceDelayMs || 10000;
  
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
 * Scans a single root directory and its level-1 children for Git repositories.
 */
const fsPromises = fs.promises;

async function isGitRepo(dir) {
  try {
    const gitDir = path.join(dir, '.git');
    const stat = await fsPromises.stat(gitDir);
    return stat.isDirectory();
  } catch (e) {
    return false;
  }
}

/**
 * Scans a single root directory and its level-1 children for Git repositories asynchronously.
 */
async function findGitRepositoriesForRoot(baseDir) {
  const repos = [];

  try {
    try {
      await fsPromises.access(baseDir);
    } catch (e) {
      logger.warn(`Base directory does not exist: ${baseDir}`);
      return repos;
    }

    if (await isGitRepo(baseDir)) {
      repos.push(baseDir);
    }

    let level1Items;
    try {
      level1Items = await fsPromises.readdir(baseDir);
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
        stat = await fsPromises.stat(fullPath);
      } catch (err) {
        continue; // skip unreadable
      }

      if (stat.isDirectory()) {
        if (await isGitRepo(fullPath)) {
          repos.push(fullPath);
        } else {
          let level2Items;
          try {
            level2Items = await fsPromises.readdir(fullPath);
          } catch (err) {
            continue; // skip unreadable level-1 subdirectory
          }

          for (const subItem of level2Items) {
            const subFullPath = path.join(fullPath, subItem);

            if (subItem === '$RECYCLE.BIN' || subItem === 'System Volume Information' || subItem === '.git' || subItem === '.agents') {
              continue;
            }

            if (await isGitRepo(subFullPath)) {
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
 * Scans all configured roots and returns unique Git repositories.
 */
async function findGitRepositories() {
  const config = getConfig();
  const roots = config.monitoredRoots || ['E:\\'];
  const allRepos = [];

  for (const root of roots) {
    const repos = await findGitRepositoriesForRoot(root);
    allRepos.push(...repos);
  }

  return [...new Set(allRepos)];
}

/**
 * Dynamic scan updates watchers to add new repos and stop watching removed ones.
 */
async function updateWatchers() {
  const currentRepos = await findGitRepositories();

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

    // Initial check on startup: trigger sync only if there are pending local changes
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
  // If baseDir is provided as a single string (from legacy/test setups), ensure it is in monitoredRoots
  if (baseDir) {
    const config = getConfig();
    if (!config.monitoredRoots.includes(baseDir)) {
      config.monitoredRoots = [baseDir];
    }
  }

  const roots = getConfig().monitoredRoots;
  logger.info(`Initializing repo watcher on roots: ${roots.join(', ')}`);
  lastScanTime = Date.now();
  
  // Perform initial scan and start watchers
  updateWatchers().catch(err => logger.error(`Initial scan failed: ${err.message}`));

  // Start 30-second periodic scan interval
  scanInterval = setInterval(async () => {
    logger.info(`Running periodic 30-second repository scan under monitored roots...`);
    lastScanTime = Date.now();
    await updateWatchers().catch(err => logger.error(`Periodic scan failed: ${err.message}`));
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
  stopAllWatchersOnly();
}

/**
 * Stop active file watchers only (helper for reload).
 */
function stopAllWatchersOnly() {
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

/**
 * Reloads watchers dynamically based on new configuration.
 */
function reloadWatcher() {
  logger.info('Reloading repository watchers dynamically...');
  stopAllWatchersOnly();
  updateWatchers().catch(err => logger.error(`Reload scan failed: ${err.message}`));
}

function getWatchedRepositoriesMetadata() {
  const metadata = {};
  const { getRemoteOriginUrl, getLastSyncTime } = require('./git-sync');
  for (const repoPath of watchers.keys()) {
    metadata[repoPath] = {
      remoteOrigin: getRemoteOriginUrl(repoPath),
      lastSyncTime: getLastSyncTime(repoPath)
    };
  }
  return {
    watchedRepositories: metadata,
    lastScanTime
  };
}

function forceGlobalScan() {
  logger.info(`Forcing repository scan under monitored roots...`);
  lastScanTime = Date.now();
  updateWatchers().catch(err => logger.error(`Force scan failed: ${err.message}`));
}

module.exports = {
  watchRepositories,
  stopWatching,
  isIgnored,
  findGitRepositories,
  getWatchedRepositoriesMetadata,
  forceGlobalScan,
  reloadWatcher
};
