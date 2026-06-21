const { exec } = require('child_process');
const logger = require('./logger');

// Queue of repository paths waiting for sync
const queue = [];
// Set of repository paths currently undergoing synchronization
const activeRepos = new Set();

/**
 * Executes a shell command in the context of a given folder, setting non-interactive Git environment.
 * @param {string} command 
 * @param {string} cwd 
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
function runCommand(command, cwd) {
    return new Promise((resolve, reject) => {
        // Set environment variables to prevent interactive prompting
        const env = { 
            ...process.env, 
            GIT_TERMINAL_PROMPT: '0', 
            GCM_INTERACTIVE: 'never' 
        };
        exec(command, { cwd, env }, (error, stdout, stderr) => {
            if (error) {
                reject({ error, stdout, stderr });
            } else {
                resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
            }
        });
    });
}

/**
 * Format date timestamp to match requirements (YYYY-MM-DD HH:mm:ss)
 */
function formatTimestamp(date = new Date()) {
    const pad = (num) => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Performs git pull, add, commit, and push operations for a given repository.
 * Handles errors gracefully without crashing the process.
 * @param {string} repoPath 
 */
async function syncRepo(repoPath) {
    logger.info(`Starting sync for repository: ${repoPath}`);
    
    // 1. Determine active branch name
    let branch;
    try {
        const { stdout } = await runCommand('git branch --show-current', repoPath);
        branch = stdout;
        if (!branch) {
            logger.warn(`No active branch found in ${repoPath} (empty repository?). Skipping.`);
            return;
        }
        logger.info(`[${repoPath}] Current branch is "${branch}"`);
    } catch (err) {
        logger.error(`[${repoPath}] Failed to get current branch: ${err.stderr || err.error.message}`);
        return;
    }
    
    // 2. Check if a remote origin repository exists
    let hasRemote = false;
    try {
        const { stdout } = await runCommand('git remote get-url origin', repoPath);
        if (stdout) {
            hasRemote = true;
            logger.info(`[${repoPath}] Remote origin URL: ${stdout}`);
        }
    } catch (err) {
        logger.info(`[${repoPath}] No remote origin configured (local only commits).`);
    }
    
    // 3. Pull from origin branch if remote exists
    if (hasRemote) {
        try {
            logger.info(`[${repoPath}] Pulling updates from remote origin/${branch}...`);
            await runCommand(`git pull origin "${branch}"`, repoPath);
            logger.info(`[${repoPath}] Pull succeeded.`);
        } catch (err) {
            logger.error(`[${repoPath}] Pull failed: ${err.stderr || err.error.message}. Skipping this sync iteration to prevent conflicts.`);
            return;
        }
    }
    
    // 4. Check status for modified/untracked files
    let hasChanges = false;
    try {
        const { stdout } = await runCommand('git status --porcelain', repoPath);
        if (stdout) {
            hasChanges = true;
            logger.info(`[${repoPath}] Uncommitted changes detected:\n${stdout}`);
        } else {
            logger.info(`[${repoPath}] Directory is clean. Nothing to sync.`);
        }
    } catch (err) {
        logger.error(`[${repoPath}] Failed to check status: ${err.stderr || err.error.message}`);
        return;
    }
    
    // 5. Stage, commit, and push changes if any exist
    if (hasChanges) {
        try {
            logger.info(`[${repoPath}] Staging all changes...`);
            await runCommand('git add -A', repoPath);
            
            const commitMsg = `Auto-sync: ${formatTimestamp()}`;
            logger.info(`[${repoPath}] Committing with message: "${commitMsg}"`);
            await runCommand(`git commit -m "${commitMsg}"`, repoPath);
            logger.info(`[${repoPath}] Commit succeeded.`);
        } catch (err) {
            logger.error(`[${repoPath}] Commit failed: ${err.stderr || err.error.message}`);
            return;
        }
        
        if (hasRemote) {
            try {
                logger.info(`[${repoPath}] Pushing changes to remote origin/${branch}...`);
                await runCommand(`git push origin "${branch}"`, repoPath);
                logger.info(`[${repoPath}] Push succeeded.`);
            } catch (err) {
                logger.error(`[${repoPath}] Push failed: ${err.stderr || err.error.message}`);
                return;
            }
        }
    }
    logger.info(`Finished sync for repository: ${repoPath}`);
}

/**
 * Processes the next repository in the queue.
 */
async function processQueue() {
    if (queue.length === 0) return;
    
    // Find first repository in queue that isn't currently being synchronized
    const nextIndex = queue.findIndex(repo => !activeRepos.has(repo));
    if (nextIndex === -1) return;
    
    // Extract it from queue
    const repoPath = queue.splice(nextIndex, 1)[0];
    activeRepos.add(repoPath);
    
    try {
        await syncRepo(repoPath);
    } catch (err) {
        logger.error(`Unexpected crash in syncRepo for ${repoPath}: ${err.message}`);
    } finally {
        activeRepos.delete(repoPath);
        // Recurse to process subsequent items
        processQueue();
    }
}

/**
 * Enqueues a synchronization job for a repository path.
 * @param {string} repoPath 
 */
function triggerSync(repoPath) {
    if (!queue.includes(repoPath)) {
        queue.push(repoPath);
        logger.info(`Enqueued sync job for: ${repoPath}`);
    }
    processQueue();
}

module.exports = {
    triggerSync
};
