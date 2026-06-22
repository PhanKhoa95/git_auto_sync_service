const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { showNotification, showGitErrorNotification } = require('./notifier');
const { registerChildProcess } = require('./child-process-registry');

function getErrorMessage(err) {
  if (!err) return 'Unknown error';
  if (err.error && err.error.message) return err.error.message;
  if (err.message) return err.message;
  if (typeof err === 'object') {
    try {
      return JSON.stringify(err);
    } catch (e) {}
  }
  return String(err);
}

const lastSyncTimes = new Map(); // repoPath -> ISOString

function getLastSyncTime(repoPath) {
  return lastSyncTimes.get(repoPath) || null;
}

/**
 * Reads branch name directly from .git/HEAD to avoid process spawning.
 */
function getBranchName(repoPath) {
  try {
    const headPath = path.join(repoPath, '.git', 'HEAD');
    if (fs.existsSync(headPath)) {
      const content = fs.readFileSync(headPath, 'utf8').trim();
      if (content.startsWith('ref: ')) {
        return content.replace('ref: refs/heads/', '').trim();
      }
      return 'HEAD'; // detached HEAD
    }
  } catch (e) {}
  return null;
}

/**
 * Reads remote config directly from .git/config to avoid process spawning.
 */
function hasOriginRemote(repoPath) {
  try {
    const configPath = path.join(repoPath, '.git', 'config');
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      return content.includes('[remote "origin"]');
    }
  } catch (e) {}
  return false;
}

/**
 * Parses .git/config to retrieve remote origin URL without spawning processes.
 */
function getRemoteOriginUrl(repoPath) {
  try {
    const configPath = path.join(repoPath, '.git', 'config');
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      const match = content.match(/\[remote\s+"origin"\][^]*?url\s*=\s*(.*?)(?:\r?\n)/i);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
  } catch (e) {}
  return null;
}

/**
 * Scans the .git folder for any stale .lock files (e.g. index.lock) older than 60 seconds and unlinks them.
 */
function clearStaleGitLocks(repoPath) {
  try {
    const gitDir = path.join(repoPath, '.git');
    if (!fs.existsSync(gitDir)) return;
    
    const items = fs.readdirSync(gitDir);
    for (const item of items) {
      if (item.endsWith('.lock')) {
        const lockPath = path.join(gitDir, item);
        try {
          const stats = fs.statSync(lockPath);
          const ageMs = Date.now() - stats.mtimeMs;
          if (ageMs > 60000) { // 60 seconds
            logger.warn(`[${path.basename(repoPath)}] Stale git lock file found: ${item} (age: ${Math.round(ageMs / 1000)}s). Removing to self-fix...`);
            fs.unlinkSync(lockPath);
            logger.info(`[${path.basename(repoPath)}] Stale lock file ${item} removed successfully.`);
          }
        } catch (e) {
          logger.warn(`[${path.basename(repoPath)}] Failed to read/delete stale lock file ${item}: ${getErrorMessage(e)}`);
        }
      }
    }
  } catch (err) {
    logger.warn(`[${path.basename(repoPath)}] Failed to clean stale git locks: ${getErrorMessage(err)}`);
  }
}

/**
 * Checks if a merge is in progress and aborts it to keep the repository clean.
 */
async function abortMergeIfNeeded(repoPath, repoName) {
  try {
    const mergeHeadPath = path.join(repoPath, '.git', 'MERGE_HEAD');
    if (fs.existsSync(mergeHeadPath)) {
      logger.warn(`[${repoName}] Merge conflict or active merge state detected. Aborting merge to restore clean state...`);
      await runGit(repoPath, ['merge', '--abort']);
      logger.info(`[${repoName}] Merge aborted successfully.`);
    }
  } catch (abortErr) {
    logger.warn(`[${repoName}] Failed to abort merge: ${getErrorMessage(abortErr)}`);
  }
}


/**
 * Automatically detects symbolic links and directory junctions in the repo
 * and adds them to .git/info/exclude to prevent Git from infinitely recursing.
 */
function excludeSymlinks(repoPath) {
  try {
    const excludePath = path.join(repoPath, '.git', 'info', 'exclude');
    
    // Ensure .git/info exists
    const infoDir = path.dirname(excludePath);
    if (!fs.existsSync(infoDir)) {
      fs.mkdirSync(infoDir, { recursive: true });
    }

    // Read existing excludes
    let excludes = [];
    if (fs.existsSync(excludePath)) {
      excludes = fs.readFileSync(excludePath, 'utf8').split('\n').map(l => l.trim());
    }

    const items = fs.readdirSync(repoPath);
    let modified = false;

    for (const item of items) {
      if (item === '.git') continue;
      const fullPath = path.join(repoPath, item);
      try {
        const stat = fs.lstatSync(fullPath);
        if (stat.isSymbolicLink()) {
          // Add to excludes if not already present
          if (!excludes.includes(item) && !excludes.includes(item + '/')) {
            excludes.push(item);
            modified = true;
          }
        }
      } catch (e) {
        // ignore
      }
    }

    if (modified) {
      fs.writeFileSync(excludePath, excludes.join('\n') + '\n', 'utf8');
    }
  } catch (err) {
    logger.warn(`Failed to configure symlink excludes: ${getErrorMessage(err)}`);
  }
}

// Store active sync promise chain per repo path to ensure sequential execution per repository
const activeSyncs = new Map(); // repoPath -> Promise
// Cache for checking whether a repository has 'origin' remote configured
const repoRemoteCache = new Map(); // repoPath -> boolean

/**
 * Runs a git command in the context of the repository, setting non-interactive env vars.
 */
function runGit(repoPath, args) {
  return new Promise((resolve, reject) => {
    const options = {
      cwd: repoPath,
      shell: false,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        GIT_SSH_COMMAND: 'ssh -o ConnectTimeout=1 -o ConnectionAttempts=1'
      }
    };

    let gitArgs = [
      '-c', 'gc.auto=0',
      '-c', 'core.preloadindex=true',
      '-c', 'core.symlinks=true',
      ...args
    ];

    if (options.shell) {
      gitArgs = gitArgs.map(arg => {
        if (typeof arg === 'string' && (arg.includes(' ') || arg.includes('"'))) {
          return `"${arg.replace(/"/g, '\\"')}"`;
        }
        return arg;
      });
    }

    const child = execFile('git', gitArgs, options, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stdout, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
    registerChildProcess(child);
  });
}

/**
 * Queue wrapper to serialize sync execution per repository.
 * If a sync is already running for a repository, subsequent events are chained.
 */
function syncRepository(repoPath) {
  const repoName = path.basename(repoPath);

  // Get existing promise chain or start a new resolved promise
  const currentChain = activeSyncs.get(repoPath) || Promise.resolve();

  // Chain the new sync operation
  const nextChain = currentChain.then(async () => {
    try {
      await performSync(repoPath);
    } catch (err) {
      logger.error(`[${repoName}] Unexpected error during sync: ${getErrorMessage(err)}`);
    }
  }).catch((err) => {
    logger.error(`[${repoName}] Critical queue chain error: ${getErrorMessage(err)}`);
  });

  // Save the new chain
  activeSyncs.set(repoPath, nextChain);

  // Clean up when the chain completes to avoid memory leak if no more pending syncs
  nextChain.then(() => {
    if (activeSyncs.get(repoPath) === nextChain) {
      activeSyncs.delete(repoPath);
    }
  });

  return nextChain;
}

/**
 * Synchronizes a single Git repository by running pull, add, commit, and push.
 * Handles errors gracefully and returns without throwing.
 */
async function performSync(repoPath) {
  const repoName = path.basename(repoPath);
  logger.info(`[${repoName}] Starting synchronization cycle...`);

  // Ensure repo exists in the filesystem (might have been deleted during debounce/queue time)
  if (!require('fs').existsSync(repoPath)) {
    logger.warn(`[${repoName}] Repository path does not exist. Skipping sync.`);
    return;
  }

  // Clear any stale git lock files left by crashed processes
  clearStaleGitLocks(repoPath);

  try {
    // Exclude any symbolic links or directory junctions to avoid circular recursion loops
    excludeSymlinks(repoPath);

    // 1. Get current branch name directly from .git/HEAD to avoid process spawning
    let branch = getBranchName(repoPath);
    if (!branch) {
      try {
        const { stdout } = await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
        branch = stdout.trim();
      } catch (err) {
        logger.error(`[${repoName}] Failed to get current branch name: ${getErrorMessage(err)}`);
        showGitErrorNotification(repoName, 'kiểm tra nhánh', getErrorMessage(err));
        return;
      }
    }

    if (branch === 'HEAD' || branch.includes('(no branch)')) {
      logger.warn(`[${repoName}] Repository is in detached HEAD state. Skipping sync.`);
      showGitErrorNotification(repoName, 'đồng bộ', 'detached head');
      return;
    }

    // Check if 'origin' remote is configured directly from .git/config (cached to avoid redundant checks)
    let hasOrigin = repoRemoteCache.get(repoPath);
    if (hasOrigin === undefined) {
      hasOrigin = hasOriginRemote(repoPath);
      repoRemoteCache.set(repoPath, hasOrigin);
    }

    // 2. Pull latest changes from remote (if origin is configured)
    if (hasOrigin) {
      logger.info(`[${repoName}] Pulling latest changes from origin ${branch}...`);
      try {
        await runGit(repoPath, ['pull', 'origin', branch]);
        logger.info(`[${repoName}] Pull successful.`);
      } catch (err) {
        const stderr = (err.stderr || '').toLowerCase();
        // If the remote branch doesn't exist yet (e.g. empty repository/new branch), proceed instead of failing
        if (stderr.includes("couldn't find remote ref") || stderr.includes("no such ref") || stderr.includes("find remote ref")) {
          logger.warn(`[${repoName}] Remote branch ${branch} not found on origin. Proceeding with initial sync.`);
        } else if (stderr.includes("refusing to merge unrelated histories")) {
          logger.warn(`[${repoName}] Unrelated histories detected. Autopilot self-fixing: retrying pull with --allow-unrelated-histories...`);
          try {
            await runGit(repoPath, ['pull', 'origin', branch, '--allow-unrelated-histories']);
            logger.info(`[${repoName}] Pull with unrelated histories successful.`);
          } catch (retryErr) {
            const errDetails = retryErr.stderr ? retryErr.stderr.trim() : getErrorMessage(retryErr);
            logger.error(`[${repoName}] Pull with unrelated histories failed: ${getErrorMessage(retryErr)}. Output: ${retryErr.stderr ? retryErr.stderr.trim() : ''}`);
            await abortMergeIfNeeded(repoPath, repoName);
            showGitErrorNotification(repoName, 'cập nhật (pull)', errDetails);
            return;
          }
        } else {
          const errDetails = err.stderr ? err.stderr.trim() : getErrorMessage(err);
          logger.error(`[${repoName}] Pull failed: ${getErrorMessage(err)}. Output: ${err.stderr ? err.stderr.trim() : ''}`);
          await abortMergeIfNeeded(repoPath, repoName);
          showGitErrorNotification(repoName, 'cập nhật (pull)', errDetails);
          logger.warn(`[${repoName}] Skipping remainder of synchronization cycle to prevent conflict compounding.`);
          return;
        }
      }
    }

    // 3. Check for local modifications (unstaged or staged) after pull
    let statusOutput;
    try {
      const { stdout } = await runGit(repoPath, ['status', '--porcelain']);
      statusOutput = stdout.trim();
    } catch (err) {
      logger.error(`[${repoName}] Failed to check status: ${getErrorMessage(err)}`);
      showGitErrorNotification(repoName, 'kiểm tra trạng thái', getErrorMessage(err));
      return;
    }

    if (!statusOutput) {
      logger.info(`[${repoName}] Working tree clean. No local modifications to sync.`);
      lastSyncTimes.set(repoPath, new Date().toISOString());
      return;
    }

    // 4. Stage all changes
    logger.info(`[${repoName}] Staging all changes...`);
    try {
      await runGit(repoPath, ['add', '-A']);
    } catch (err) {
      logger.error(`[${repoName}] Staging failed: ${getErrorMessage(err)}`);
      showGitErrorNotification(repoName, 'lưu thay đổi (stage)', getErrorMessage(err));
      return;
    }

    // 5. Commit changes with timestamp
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const commitMessage = `Auto-sync: ${timestamp}`;
    logger.info(`[${repoName}] Committing changes with message: "${commitMessage}"...`);
    try {
      await runGit(repoPath, ['commit', '-m', commitMessage]);
      logger.info(`[${repoName}] Commit successful.`);
    } catch (err) {
      const stderr = (err.stderr || '').toLowerCase();
      if (stderr.includes('tell me who you are') || stderr.includes('author identity unknown')) {
        logger.warn(`[${repoName}] Git user identity not configured. Autopilot self-fixing: configuring local fallback user...`);
        try {
          await runGit(repoPath, ['config', 'user.name', 'Auto-Sync Autopilot']);
          await runGit(repoPath, ['config', 'user.email', 'autopilot@sync.local']);
          // Retry commit
          await runGit(repoPath, ['commit', '-m', commitMessage]);
          logger.info(`[${repoName}] Commit successful after identity self-fixing.`);
        } catch (retryErr) {
          logger.error(`[${repoName}] Commit failed after identity self-fixing attempt: ${getErrorMessage(retryErr)}`);
          showGitErrorNotification(repoName, 'ghi nhận thay đổi (commit)', 'please tell me who you are');
          return;
        }
      } else {
        logger.error(`[${repoName}] Commit failed: ${getErrorMessage(err)}`);
        showGitErrorNotification(repoName, 'ghi nhận thay đổi (commit)', getErrorMessage(err));
        return;
      }
    }

    // 6. Push to remote (if origin is configured)
    if (hasOrigin) {
      logger.info(`[${repoName}] Pushing changes to origin ${branch}...`);
      try {
        await runGit(repoPath, ['push', 'origin', branch]);
        logger.info(`[${repoName}] Push successful.`);
      } catch (err) {
        const stderr = (err.stderr || '').toLowerCase();
        if (stderr.includes('non-fast-forward') || stderr.includes('updates were rejected') || stderr.includes('fetch first')) {
          logger.warn(`[${repoName}] Push rejected due to non-fast-forward. Autopilot self-fixing: pulling remote changes and retrying push...`);
          try {
            try {
              await runGit(repoPath, ['pull', 'origin', branch]);
            } catch (pullErr) {
              const pullStderr = (pullErr.stderr || '').toLowerCase();
              if (pullStderr.includes('refusing to merge unrelated histories')) {
                logger.warn(`[${repoName}] Unrelated histories during push retry. Pulling with --allow-unrelated-histories...`);
                await runGit(repoPath, ['pull', 'origin', branch, '--allow-unrelated-histories']);
              } else {
                throw pullErr;
              }
            }
            logger.info(`[${repoName}] Pull successful. Re-trying push...`);
            await runGit(repoPath, ['push', 'origin', branch]);
            logger.info(`[${repoName}] Push successful after retrying.`);
          } catch (retryErr) {
            const errDetails = retryErr.stderr ? retryErr.stderr.trim() : getErrorMessage(retryErr);
            logger.error(`[${repoName}] Pull/push recovery failed: ${getErrorMessage(retryErr)}. Output: ${retryErr.stderr ? retryErr.stderr.trim() : ''}`);
            await abortMergeIfNeeded(repoPath, repoName);
            showGitErrorNotification(repoName, 'đẩy thay đổi (push)', errDetails);
            return;
          }
        } else {
          const errDetails = err.stderr ? err.stderr.trim() : getErrorMessage(err);
          logger.error(`[${repoName}] Push failed: ${getErrorMessage(err)}. Output: ${err.stderr.trim()}`);
          showGitErrorNotification(repoName, 'đẩy thay đổi (push)', errDetails);
          return;
        }
      }
    }

    logger.info(`[${repoName}] Synchronization cycle completed successfully.`);
    lastSyncTimes.set(repoPath, new Date().toISOString());
  } catch (err) {
    logger.error(`[${repoName}] Unexpected error during sync: ${getErrorMessage(err)}`);
  }
}

/**
 * Performs a pull operation only. Used by periodic synchronization check.
 */
async function pullOnly(repoPath) {
  const repoName = path.basename(repoPath);

  // Serialize execution per repository to avoid index lock conflicts
  const currentChain = activeSyncs.get(repoPath) || Promise.resolve();

  const nextChain = currentChain.then(async () => {
    try {
      if (!fs.existsSync(repoPath)) return;
      
      clearStaleGitLocks(repoPath);
      excludeSymlinks(repoPath);

      let branch = getBranchName(repoPath);
      if (!branch) {
        try {
          const { stdout } = await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
          branch = stdout.trim();
        } catch (err) {
          logger.error(`[${repoName}] Failed to get branch for periodic pull: ${getErrorMessage(err)}`);
          return;
        }
      }

      if (branch === 'HEAD' || branch.includes('(no branch)')) {
        return;
      }

      let hasOrigin = repoRemoteCache.get(repoPath);
      if (hasOrigin === undefined) {
        hasOrigin = hasOriginRemote(repoPath);
        repoRemoteCache.set(repoPath, hasOrigin);
      }

      if (hasOrigin) {
        logger.info(`[${repoName}] Checking for remote updates (pulling from origin ${branch})...`);
        try {
          const { stdout } = await runGit(repoPath, ['pull', 'origin', branch]);
          if (stdout.includes('Already up to date.') || stdout.includes('Already up-to-date.')) {
            // No new remote changes
          } else {
            logger.info(`[${repoName}] Pull successful: Remote changes fetched.`);
            lastSyncTimes.set(repoPath, new Date().toISOString());
          }
        } catch (err) {
          const stderr = (err.stderr || '').toLowerCase();
          if (stderr.includes("couldn't find remote ref") || stderr.includes("no such ref") || stderr.includes("find remote ref")) {
            // ignore empty remote refs
          } else if (stderr.includes("refusing to merge unrelated histories")) {
            logger.warn(`[${repoName}] Unrelated histories during periodic pull. Retrying pull with --allow-unrelated-histories...`);
            try {
              await runGit(repoPath, ['pull', 'origin', branch, '--allow-unrelated-histories']);
              logger.info(`[${repoName}] Periodic pull with unrelated histories successful.`);
              lastSyncTimes.set(repoPath, new Date().toISOString());
            } catch (retryErr) {
              const errDetails = retryErr.stderr ? retryErr.stderr.trim() : getErrorMessage(retryErr);
              logger.error(`[${repoName}] Periodic pull with unrelated histories failed: ${getErrorMessage(retryErr)}`);
              await abortMergeIfNeeded(repoPath, repoName);
              showGitErrorNotification(repoName, 'cập nhật tự động (pull)', errDetails);
            }
          } else {
            const errDetails = err.stderr ? err.stderr.trim() : getErrorMessage(err);
            logger.error(`[${repoName}] Periodic pull failed: ${getErrorMessage(err)}. Output: ${err.stderr ? err.stderr.trim() : ''}`);
            await abortMergeIfNeeded(repoPath, repoName);
            showGitErrorNotification(repoName, 'cập nhật tự động (pull)', errDetails);
          }
        }
      }
    } catch (err) {
      logger.error(`[${repoName}] Unexpected error during periodic pull: ${getErrorMessage(err)}`);
    }
  }).catch((err) => {
    logger.error(`[${repoName}] Critical pull queue error: ${getErrorMessage(err)}`);
  });

  activeSyncs.set(repoPath, nextChain);

  nextChain.then(() => {
    if (activeSyncs.get(repoPath) === nextChain) {
      activeSyncs.delete(repoPath);
    }
  });

  return nextChain;
}

function clearRepositoryCache(repoPath) {
  activeSyncs.delete(repoPath);
  repoRemoteCache.delete(repoPath);
  lastSyncTimes.delete(repoPath);
}

module.exports = {
  syncRepository,
  runGit,
  getRemoteOriginUrl,
  getLastSyncTime,
  clearRepositoryCache,
  pullOnly
};

