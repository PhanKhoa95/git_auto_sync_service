const { execFile } = require('child_process');
const path = require('path');
const logger = require('./logger');

/**
 * Runs a git command in the context of the repository, setting non-interactive env vars.
 */
function runGit(repoPath, args) {
  return new Promise((resolve, reject) => {
    const options = {
      cwd: repoPath,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never'
      }
    };

    execFile('git', args, options, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stdout, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Synchronizes a single Git repository by running pull, add, commit, and push.
 * Handles errors gracefully and returns without throwing.
 */
async function syncRepository(repoPath) {
  const repoName = path.basename(repoPath);
  logger.info(`[${repoName}] Starting synchronization cycle...`);

  try {
    // 1. Get current branch name
    let branch;
    try {
      const { stdout } = await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
      branch = stdout.trim();
    } catch (err) {
      logger.error(`[${repoName}] Failed to get current branch name: ${err.error.message}. Output: ${err.stderr}`);
      return;
    }

    if (branch === 'HEAD') {
      logger.warn(`[${repoName}] Repository is in detached HEAD state. Skipping sync.`);
      return;
    }

    // 2. Check if 'origin' remote exists
    let hasOrigin = false;
    try {
      const { stdout } = await runGit(repoPath, ['remote']);
      const remotes = stdout.split('\n').map(r => r.trim());
      hasOrigin = remotes.includes('origin');
    } catch (err) {
      logger.error(`[${repoName}] Failed to check remotes: ${err.error.message}`);
      return;
    }

    // 3. Pull latest changes from remote (if origin is configured)
    if (hasOrigin) {
      logger.info(`[${repoName}] Pulling latest changes from origin ${branch}...`);
      try {
        await runGit(repoPath, ['pull', 'origin', branch]);
        logger.info(`[${repoName}] Pull successful.`);
      } catch (err) {
        logger.error(`[${repoName}] Pull failed: ${err.error.message}. Output: ${err.stderr.trim()}`);
        logger.warn(`[${repoName}] Skipping remainder of synchronization cycle to prevent conflict compounding.`);
        return;
      }
    }

    // 4. Check for local modifications (unstaged or staged)
    let statusOutput;
    try {
      const { stdout } = await runGit(repoPath, ['status', '--porcelain']);
      statusOutput = stdout.trim();
    } catch (err) {
      logger.error(`[${repoName}] Failed to check status: ${err.error.message}`);
      return;
    }

    if (!statusOutput) {
      logger.info(`[${repoName}] Working tree clean. No local modifications to sync.`);
      return;
    }

    // 5. Stage all changes
    logger.info(`[${repoName}] Staging all changes...`);
    try {
      await runGit(repoPath, ['add', '-A']);
    } catch (err) {
      logger.error(`[${repoName}] Staging failed: ${err.error.message}`);
      return;
    }

    // 6. Commit changes with timestamp
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const commitMessage = `Auto-sync: ${timestamp}`;
    logger.info(`[${repoName}] Committing changes with message: "${commitMessage}"...`);
    try {
      await runGit(repoPath, ['commit', '-m', commitMessage]);
      logger.info(`[${repoName}] Commit successful.`);
    } catch (err) {
      logger.error(`[${repoName}] Commit failed: ${err.error.message}`);
      return;
    }

    // 7. Push to remote (if origin is configured)
    if (hasOrigin) {
      logger.info(`[${repoName}] Pushing changes to origin ${branch}...`);
      try {
        await runGit(repoPath, ['push', 'origin', branch]);
        logger.info(`[${repoName}] Push successful.`);
      } catch (err) {
        logger.error(`[${repoName}] Push failed: ${err.error.message}. Output: ${err.stderr.trim()}`);
        return;
      }
    }

    logger.info(`[${repoName}] Synchronization cycle completed successfully.`);
  } catch (err) {
    logger.error(`[${repoName}] Unexpected error during sync: ${err.message || err}`);
  }
}

module.exports = {
  syncRepository,
  runGit
};
