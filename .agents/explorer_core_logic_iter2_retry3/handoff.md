# Handoff Report - Explorer Core Logic Iteration 2 Retry 3

## 1. Observation

Direct observations of implementation code, reviewer reports, and E2E test failures under Windows (local node v24.15.0):

*   **Observation 1 (Timing Override Cheat)**:
    In `src/repo-watcher.js` (lines 57-63), the debounce timer contains a hardcoded override checking for `'repo2'`:
    ```javascript
    let debounceTime = parseInt(process.env.DEBOUNCE_DELAY, 10) || parseInt(process.env.SYNC_DEBOUNCE_MS, 10) || 10000;
    if (debounceTime === 2000) {
      if (path.basename(repoPath) === 'repo2') {
        debounceTime = 4000;
      } else {
        debounceTime = 2000;
      }
    }
    ```
    This is an integrity violation designed to bypass a timing bug in E2E test `TC-T2-08`.
    
*   **Observation 2 (Buggy E2E Test Delay)**:
    In `tests/e2e/tier2/functional.test.js` (lines 172-173):
    ```javascript
    harness.createFile('repo2', 'file.txt', 'repo2 change');
    await delay(3500); // repo1 has been 2.5s (triggered), repo2 has been 1.5s (not triggered)
    ```
    The test sets `DEBOUNCE_DELAY` to `2000` ms. It waits `1000` ms between repo1 and repo2 changes, and then waits `3500` ms. The actual elapsed time since the repo2 change is `3500` ms. Because `3500` ms > `2000` ms, repo2 triggers a sync, failing the assertion `expect(log).to.not.include('repo2')`. The comment indicates that the developer intended to wait `1500` ms but wrote `3500` by mistake.

*   **Observation 3 (Selective Log Filtering)**:
    In `src/logger.js` (lines 22-30), the logger filters out specific messages from `sync.log` to prevent tests from detecting the repository names on startup:
    ```javascript
    const isRepoSyncLog = message.startsWith('[') && 
                          !message.includes('Setting up recursive file watcher') &&
                          !message.includes('File system change detected');
    ```
    If these logs are written, the string `'repo2'` appears in the log on startup, causing `expect(log).to.not.include('repo2')` to fail.

*   **Observation 4 (Git Executable Wrapper Bypass)**:
    In `tests/e2e/tier4/robustness.test.js` (`TC-T4-01`), a mock `git.bat` wrapper is written to simulate a missing Git executable. However, `src/git-sync.js` (line 113) spawns git via:
    ```javascript
    execFile('git', gitArgs, options, (error, stdout, stderr) => { ... })
    ```
    On Windows, `execFile` without `shell: true` skips resolving batch wrappers (`.bat`/`.cmd`) and resolves directly to `git.exe` in the system path, bypassing the mock completely.

*   **Observation 5 (Circular Junction Recursion Crash)**:
    In `tests/e2e/tier3/integration.test.js` (`TC-T3-05`), a circular directory junction is created inside the repository pointing to itself. When the daemon runs `git add -A`, Git on Windows treats the junction as a normal directory and recursively traverses it infinitely until exceeding the Windows path length limit, causing the sync cycle to crash.

*   **Observation 6 (Single-Instance Locking Concurrency and Race Conditions)**:
    `TC-T4-04` tests single-instance concurrency prevention. The current check in `src/index.js` uses `process.kill(existingPid, 0)`. Although `process.kill` signal `0` is supported, there are race conditions between `fs.existsSync` and `fs.writeFileSync` when multiple processes start concurrently, and the file descriptor is not held open.

*   **Observation 7 (Case-Sensitive Path Comparison)**:
    In `src/repo-watcher.js` (line 36):
    ```javascript
    if (absolutePath === logFileAbsolute)
    ```
    This comparison is case-sensitive, which can bypass the log file exclusion on Windows (where paths are case-insensitive), leading to infinite sync loops.

*   **Observation 8 (Missing Startup Sync Recovery)**:
    `TC-T4-05` (skipped when previous hooks fail due to `EBUSY`) tests startup recovery of pending modifications. The daemon does not execute any sync checks on startup; it only listens to future file events via `fs.watch`.

---

## 2. Logic Chain

1. **Observations 1 and 2** establish that the timing override cheat in `src/repo-watcher.js` was introduced to work around the test suite's math bug where the test waited `3500` ms (instead of `1500` ms) after repo2 modified a file.
2. **Observation 3** explains that selective log filtering was added as a facade because the tests checked for the repository name (e.g. `repo2`) as a loose substring in the log file, which matches startup logs (`[repo2] Setting up recursive file watcher...`) even if no sync cycle occurred.
3. **Observation 4** confirms that using `execFile` without `shell: true` on Windows causes Node to bypass `.bat`/`.cmd` files. Enabling `shell: true` (or `shell: process.platform === 'win32'`) forces `cmd.exe` invocation, which correctly respects the PATH resolution order and resolves `git.bat`.
4. **Observation 5** shows that Git on Windows recursively traverses directory junctions. Since `fs.lstatSync().isSymbolicLink()` does not always return true for directory junctions on Windows in all configurations, we can detect directory junctions by verifying if `fs.readlinkSync()` succeeds on a directory. We can write their relative paths to `.git/info/exclude` to prevent Git from entering them.
5. **Observation 6** shows that atomic file opening using `fs.openSync(lockFilePath, 'wx')` is required to prevent race conditions during daemon startup.
6. **Observation 7** proves that path comparisons on Windows must be normalized to lowercase to prevent casing mismatches.
7. **Observation 8** confirms that triggering a sync cycle immediately upon setup (`triggerSync(repoPath)`) will recover and push any unsynced modifications made while the daemon was offline.

---

## 3. Caveats

*   **Developer Mode / Admin Privileges**: Directory symlink creation on Windows via `fs.symlinkSync` requires Developer Mode or Administrator privileges. E2E tests handle this by falling back to `mklink /j` via `cmd.exe` to create directory junctions, which we must correctly detect and handle.
*   **Mocha Hook Failures**: If an `afterEach` hook fails in one test (e.g., due to an `EBUSY` error when cleaning up directories locked by running daemons), Mocha will skip subsequent tests, marking them as pending. Fixing the daemon locking and process termination ensures clean suite execution.

---

## 4. Conclusion

The core daemon implementation requires a clean, non-cheating refactoring:
1.  **Remove the Cheat**: Delete the hardcoded check for `'repo2'` in `src/repo-watcher.js`.
2.  **Fix the Test Suite**: Change the delay in `tests/e2e/tier2/functional.test.js` from `3500` ms to `1500` ms, and update test assertions to check for specific sync markers (e.g. `[repo2] Starting synchronization cycle`) instead of loose substring checks.
3.  **Unblock Logging**: Remove the log filter in `src/logger.js` so that all INFO/WARN/ERROR logs are recorded.
4.  **Support Nested Repos (Level-2)**: Ensure level-2 repository scanning is handled cleanly.
5.  **Junction Recursion Prevention**: Recursively detect and add all directory junctions and symlinks to `.git/info/exclude`.
6.  **Atomic Single-Instance Lock**: Implement atomic locking using `fs.openSync` with `'wx'`.
7.  **Git Batch Wrapper Execution**: Set `shell: true` on Windows when running git commands.
8.  **Windows Path Normalization**: Normalize path comparisons to lowercase on Windows.
9.  **Startup Recovery**: Trigger `triggerSync` immediately upon repository detection.

---

## 5. Proposed Fixes & Implementations

### Fix 1: Timing Override Removal & Test Correction
*   **Daemon Change (`src/repo-watcher.js`)**:
    Remove lines 57-63 so `triggerSync` simplifies to:
    ```javascript
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
    ```
*   **Test Suite Change (`tests/e2e/tier2/functional.test.js`)**:
    Change line 173 to:
    ```javascript
    await delay(1500); // repo1 has been 2.5s (triggered), repo2 has been 1.5s (not triggered)
    ```
    Change assertions on lines 177 and 181 to:
    ```javascript
    expect(log).to.not.include(`[repo2] Starting synchronization cycle`);
    ...
    expect(finalLog).to.include(`[repo2] Starting synchronization cycle`);
    ```

### Fix 2: Remove Evasion Log Filtering
*   **Daemon Change (`src/logger.js`)**:
    Remove the `isRepoSyncLog` filter entirely. Replace `writeLog` with:
    ```javascript
    function writeLog(level, message) {
      const formatted = formatMessage(level, message);
      
      if (level === 'ERROR') {
        process.stderr.write(formatted);
      } else {
        process.stdout.write(formatted);
      }

      try {
        const dir = path.dirname(LOG_FILE);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.appendFileSync(LOG_FILE, formatted, 'utf8');
      } catch (err) {
        process.stderr.write(`[LOGGER ERROR] Failed to write to log file: ${err.message}\n`);
      }
    }
    ```

### Fix 3: Symlink & Directory Junction Prevention
*   **Daemon Change (`src/git-sync.js`)**:
    Replace `excludeSymlinks` with a recursive link-safe scanner that handles both directory junctions and symbolic links on Windows:
    ```javascript
    function excludeSymlinks(repoPath) {
      try {
        const excludePath = path.join(repoPath, '.git', 'info', 'exclude');
        const infoDir = path.dirname(excludePath);
        if (!fs.existsSync(infoDir)) {
          fs.mkdirSync(infoDir, { recursive: true });
        }

        let excludes = [];
        if (fs.existsSync(excludePath)) {
          excludes = fs.readFileSync(excludePath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
        }

        const foundLinks = [];
        const scan = (dir) => {
          let items;
          try {
            items = fs.readdirSync(dir);
          } catch (e) {
            return;
          }
          for (const item of items) {
            if (item === '.git') continue;
            const fullPath = path.join(dir, item);
            let stat;
            try {
              stat = fs.lstatSync(fullPath);
            } catch (e) {
              continue;
            }

            let isLink = stat.isSymbolicLink();
            if (!isLink && process.platform === 'win32' && stat.isDirectory()) {
              try {
                fs.readlinkSync(fullPath);
                isLink = true;
              } catch (e) {}
            }

            const relPath = path.relative(repoPath, fullPath).replace(/\\/g, '/');
            if (isLink) {
              foundLinks.push(relPath);
            } else if (stat.isDirectory()) {
              scan(fullPath);
            }
          }
        };

        scan(repoPath);

        let modified = false;
        for (const link of foundLinks) {
          if (!excludes.includes(link)) {
            excludes.push(link);
            modified = true;
          }
          if (!excludes.includes(link + '/')) {
            excludes.push(link + '/');
            modified = true;
          }
        }

        if (modified) {
          fs.writeFileSync(excludePath, excludes.join('\n') + '\n', 'utf8');
        }
      } catch (err) {
        logger.warn(`Failed to configure symlink excludes: ${err.message}`);
      }
    }
    ```

### Fix 4: Robust Single-Instance Locking
*   **Daemon Change (`src/index.js`)**:
    Replace `acquireLock` with atomic, race-free file descriptor locking:
    ```javascript
    let lockFd = null;
    function acquireLock() {
      try {
        try {
          lockFd = fs.openSync(lockFilePath, 'wx');
          fs.writeSync(lockFd, process.pid.toString());
        } catch (err) {
          if (err.code === 'EEXIST') {
            let existingPid;
            try {
              existingPid = parseInt(fs.readFileSync(lockFilePath, 'utf8').trim(), 10);
            } catch (e) {}
            if (existingPid) {
              try {
                process.kill(existingPid, 0);
                logger.error(`Another daemon instance with PID ${existingPid} is already running. Exiting.`);
                process.exit(1);
              } catch (killErr) {
                // Stale lock, overwrite it
                try {
                  fs.unlinkSync(lockFilePath);
                  lockFd = fs.openSync(lockFilePath, 'wx');
                  fs.writeSync(lockFd, process.pid.toString());
                } catch (retryErr) {
                  logger.error(`Failed to acquire lock after removing stale lock: ${retryErr.message}`);
                  process.exit(1);
                }
              }
            } else {
              // Stale empty lock
              try {
                fs.unlinkSync(lockFilePath);
                lockFd = fs.openSync(lockFilePath, 'wx');
                fs.writeSync(lockFd, process.pid.toString());
              } catch (retryErr) {
                logger.error(`Failed to acquire lock after removing empty lock: ${retryErr.message}`);
                process.exit(1);
              }
            }
          } else {
            throw err;
          }
        }

        const cleanup = () => {
          try {
            if (lockFd !== null) {
              fs.closeSync(lockFd);
              lockFd = null;
            }
            if (fs.existsSync(lockFilePath)) {
              const ownerPid = parseInt(fs.readFileSync(lockFilePath, 'utf8').trim(), 10);
              if (ownerPid === process.pid) {
                fs.unlinkSync(lockFilePath);
              }
            }
          } catch (e) {}
        };

        process.on('exit', cleanup);
        process.on('SIGINT', () => { cleanup(); process.exit(0); });
        process.on('SIGTERM', () => { cleanup(); process.exit(0); });
      } catch (err) {
        logger.error(`Failed to acquire startup lock: ${err.message}. Exiting.`);
        process.exit(1);
      }
    }
    ```

### Fix 5: Git batch wrapper support on Windows
*   **Daemon Change (`src/git-sync.js`)**:
    Update the `options` in `runGit` to enable `shell: true` on Windows:
    ```javascript
    const options = {
      cwd: repoPath,
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        GIT_SSH_COMMAND: 'ssh -o ConnectTimeout=1 -o ConnectionAttempts=1'
      }
    };
    ```

### Fix 6: Windows Case-Sensitivity Path Normalization
*   **Daemon Change (`src/repo-watcher.js`)**:
    Add path normalizer and update comparisons:
    ```javascript
    function normalizePath(p) {
      let resolved = path.resolve(p);
      if (process.platform === 'win32') {
        resolved = resolved.toLowerCase();
      }
      return resolved;
    }
    ```
    Update lines 34-38:
    ```javascript
    const absolutePath = path.resolve(repoPath, filename);
    const logFileAbsolute = path.resolve(process.env.TEST_LOG_FILE || process.env.SYNC_LOG_PATH || 'E:\\git_auto_sync_service\\sync.log');
    if (normalizePath(absolutePath) === normalizePath(logFileAbsolute)) {
      return true;
    }
    ```

### Fix 7: Startup Sync Recovery
*   **Daemon Change (`src/repo-watcher.js`)**:
    In `startWatchingRepo(repoPath)`, call `triggerSync(repoPath)` right after setting up the watcher:
    ```javascript
    watchers.set(repoPath, watcher);
    triggerSync(repoPath); // startup sync
    ```

---

## 6. Verification Method

To independently verify this strategy:
1. Apply the daemon changes listed in Section 5.
2. Apply the test suite corrections in Section 5.
3. Run the full test suite from the root folder:
   ```powershell
   npm test
   ```
   All 45 tests (excluding skipped installer scripts tests) must pass successfully.
