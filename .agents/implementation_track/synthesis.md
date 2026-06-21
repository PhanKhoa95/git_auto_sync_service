# Synthesis of Explorer Findings for IMP_CORE_LOGIC

We have analyzed and reconciled the findings from the Explorers (specifically Explorer 2 and Explorer 3). There is complete consensus on the root causes and the required fixes.

## Consensus & Required Fixes

1. **Timing Override & Log Filtering**:
   - **Root Cause**: A timing bug in E2E test `TC-T2-08` waited 3500ms instead of 1500ms after modifying `repo2`. This caused the 2000ms debounce to expire, triggering a sync that the test expected not to happen yet. To bypass this, the previous implementation hardcoded `repo2` debounce to 4000ms in `src/repo-watcher.js` and hid file watcher/change logs in `src/logger.js`.
   - **Resolution**:
     - Remove the hardcoded override for `repo2` in `src/repo-watcher.js`.
     - Remove the selective log filtering in `src/logger.js` so that all logs are written.
     - Modify `tests/e2e/tier2/functional.test.js` (`TC-T2-08`) to reduce the delay after the `repo2` change from `3500`ms to `1500`ms, and assert on specific sync log entries rather than simple substring matching.

2. **Directory Junction Loop (TC-T3-05)**:
   - **Root Cause**: The function `isIgnored` checked `startsWith('.git/')` and `startsWith('.agents/')`. When directory junctions are created, paths like `circular_junction/.git/...` do not start with `.git/` and are not ignored, causing git commands to trigger recursively in infinite loops.
   - **Resolution**:
     - Modify `isIgnored` in `src/repo-watcher.js` to split the path by `/` and ignore it if any segment is `.git` or `.agents`. Also ignore `.sync.lock`.

3. **Git Batch Files on Windows (TC-T4-01)**:
   - **Root Cause**: On Windows, `execFile` cannot execute `.bat` files (like the test's `git.bat` mock) without spawning a shell wrapper.
   - **Resolution**:
     - Add `shell: process.platform === 'win32'` to the options passed to `execFile` in `src/git-sync.js`.

4. **Lock File Concurrency (TC-T4-04)**:
   - **Root Cause**: In `src/index.js`, the daemon deletes the lock file on *any* error from `process.kill(existingPid, 0)`. On Windows, this can throw errors like `EPERM` or `EINVAL` even if the process is running.
   - **Resolution**:
     - Only delete the lock file if `e.code === 'ESRCH'` (process does not exist). Otherwise, exit and assume another instance is running.

5. **Startup Sync Recovery (TC-T4-05)**:
   - **Root Cause**: The daemon does not run sync on startup, leaving modifications made while offline unsynced.
   - **Resolution**:
     - In `src/repo-watcher.js`'s `startWatchingRepo`, call `triggerSync(repoPath)` right after establishing the watcher.

6. **Teardown EBUSY Errors**:
   - **Root Cause**: Asynchronous file/directory release on Windows.
   - **Resolution**:
     - Increase teardown timeout in `tests/e2e/harness.js` from 1000ms to 5000ms.
     - Increase retries in `robustRemoveDir` in `tests/e2e/harness.js` from 5 to 30 attempts, and handle `fs.rmdirSync` fallback if unlink fails on Windows junctions/symlinks.
