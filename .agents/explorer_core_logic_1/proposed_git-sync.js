const { exec } = require('child_process');
const logger = require('./logger');

// Sets containing active and pending sync operations per repository path to prevent concurrent executions
const activeSyncs = new Set();
const pendingSyncs = new Set();

/**
 * Runs a command in the specified directory with non-interactive Git environment variables.
 * 
 * @param {string} cmd The shell command to run
 * @param {string} cwd The directory path in which to run the command
 * @returns {Promise<{stdout: string, stderr: string}>} Resolves with stdout and stderr on success
 */
function runCmd(cmd, cwd) {
    return new Promise((resolve, reject) => {
        const env = {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
            GCM_INTERACTIVE: 'never'
        };
        exec(cmd, { cwd, env }, (error, stdout, stderr) => {
            if (error) {
                reject({ error, stdout, stderr });
            } else {
                resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
            }
        });
    });
}

/**
 * Performs sequential Git synchronization (pull, stage, commit, push) for a repository.
 * Safe command execution: logs failures and returns instead of throwing or crashing.
 * 
 * @param {string} repoPath The absolute path of the Git repository
 */
async function syncRepository(repoPath) {
    logger.info(`[${repoPath}] Starting sync execution.`);
    try {
        // 1. Check current branch
        let branch;
        try {
            const { stdout } = await runCmd('git branch --show-current', repoPath);
            branch = stdout;
        } catch (err) {
            logger.error(`[${repoPath}] Failed to get current branch (uninitialized repo?): ${err.stderr || err.error.message}`);
            return;
        }

        if (!branch) {
            logger.warn(`[${repoPath}] No active branch detected. Skipping.`);
            return;
        }

        // 2. Check if remote 'origin' is configured
        let hasOrigin = false;
        try {
            const { stdout } = await runCmd('git remote', repoPath);
            const remotes = stdout.split(/\r?\n/).map(r => r.trim());
            hasOrigin = remotes.includes('origin');
        } catch (err) {
            logger.error(`[${repoPath}] Failed to query remotes: ${err.stderr || err.error.message}`);
        }

        // 3. Pull from origin if configured
        if (hasOrigin) {
            logger.info(`[${repoPath}] Pulling updates from origin/${branch}...`);
            try {
                await runCmd(`git pull origin ${branch}`, repoPath);
                logger.info(`[${repoPath}] Pull completed successfully.`);
            } catch (err) {
                logger.error(`[${repoPath}] Git pull failed. Skipping further sync for safety: ${err.stderr || err.error.message}`);
                return; // Skip staging/pushing to avoid committing over local-remote mismatches or conflicts
            }
        }

        // 4. Check for modifications to commit
        let hasChanges = false;
        try {
            const { stdout } = await runCmd('git status --porcelain', repoPath);
            hasChanges = stdout.length > 0;
        } catch (err) {
            logger.error(`[${repoPath}] Failed to check status: ${err.stderr || err.error.message}`);
            return;
        }

        if (hasChanges) {
            logger.info(`[${repoPath}] Local changes detected. Staging...`);
            try {
                await runCmd('git add -A', repoPath);
                
                const pad = (n) => String(n).padStart(2, '0');
                const now = new Date();
                const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
                const commitMsg = `Auto-sync: ${timestamp}`;
                
                await runCmd(`git commit -m "${commitMsg}"`, repoPath);
                logger.info(`[${repoPath}] Committed changes: "${commitMsg}"`);
            } catch (err) {
                logger.error(`[${repoPath}] Git commit failed: ${err.stderr || err.error.message}`);
                return;
            }
        } else {
            logger.info(`[${repoPath}] No local changes to commit.`);
        }

        // 5. Push to origin if configured
        if (hasOrigin) {
            logger.info(`[${repoPath}] Pushing updates to origin/${branch}...`);
            try {
                await runCmd(`git push origin ${branch}`, repoPath);
                logger.info(`[${repoPath}] Push completed successfully.`);
            } catch (err) {
                logger.error(`[${repoPath}] Git push failed: ${err.stderr || err.error.message}`);
            }
        }
    } catch (globalErr) {
        logger.error(`[${repoPath}] Unexpected error in sync sequence: ${globalErr.message}`);
    }
}

/**
 * Enqueues a sync operation for a repository path.
 * Ensures that only one sync operation runs at a time for any given repository.
 * 
 * @param {string} repoPath The absolute path of the repository to synchronize
 */
function triggerSync(repoPath) {
    if (activeSyncs.has(repoPath)) {
        logger.info(`[${repoPath}] Sync already in progress. Queueing a pending sync.`);
        pendingSyncs.add(repoPath);
        return;
    }

    activeSyncs.add(repoPath);

    syncRepository(repoPath).finally(() => {
        activeSyncs.delete(repoPath);
        if (pendingSyncs.has(repoPath)) {
            pendingSyncs.delete(repoPath);
            logger.info(`[${repoPath}] Executing pending sync after previous finished.`);
            process.nextTick(() => triggerSync(repoPath));
        }
    });
}

module.exports = {
    triggerSync
};
