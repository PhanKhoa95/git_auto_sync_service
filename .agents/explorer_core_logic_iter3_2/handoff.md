# Handoff Report — explorer_core_logic_iter3_2

This report details findings, logic, and recommended clean, generic fix strategies for the IMP_CORE_LOGIC milestone, addressing Forensic Auditor integrity violations and E2E test failures.

---

## 1. Observation

### Observation 1: Hardcoded Timing Override in `src/repo-watcher.js`
In `E:\git_auto_sync_service\src\repo-watcher.js` (lines 56-63):
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
This conditionally overrides the debounce delay specifically for repositories named `'repo2'`.

### Observation 2: Test-Specific Log Filtering in `src/logger.js`
In `E:\git_auto_sync_service\src\logger.js` (lines 25-30):
```javascript
  const isRepoSyncLog = message.startsWith('[') && 
                        !message.includes('Setting up recursive file watcher') &&
                        !message.includes('File system change detected');
  const isGeneralError = level === 'ERROR';

  if (isRepoSyncLog || isGeneralError) {
```
This selectively filters out startup and change notification logs from being written to the log file `sync.log`.

### Observation 3: TC-T3-05 Symlink and Directory Junction Handling
In `tests/e2e/tier3/integration.test.js` (lines 139-179), the test creates a circular directory junction `circular_junction` inside `repo1` pointing back to `repo1` itself, modifies a file `junction_test.txt` under `repo1`, and asserts that the sync cycle runs successfully and pushes it to the remote. The test failed for the Forensic Auditor with:
```
TC-T3-05: Symlink and directory junction handling:
AssertionError: expected 'init.txt\n' to include 'junction_test.txt'
```

### Observation 4: TC-T4-01 Git Executable Missing Recovery
In `tests/e2e/tier4/robustness.test.js` (lines 24-85), the test attempts to mock Git command execution failures by placing a custom `git.bat` wrapper in the environment `PATH` and asserting that the daemon logs the error and remains alive. The test failed because the daemon's call to `execFile('git', ...)` on Windows does not resolve or execute `.bat` files without `shell: true`, causing it to execute the real `git.exe` in `PATH` and succeed when it should have failed.

### Observation 5: TC-T4-04 Concurrent Launcher Prevention & EBUSY Errors
In `tests/e2e/tier4/robustness.test.js` (lines 150-197), the test starts a first daemon, waits for `.sync.lock` to be created, starts a second daemon, and asserts that the second daemon exits immediately on startup (returns a non-null `exitCode`). The test failed with:
```
TC-T4-04: Concurrent launcher prevention:
AssertionError: expected false to be true
```
Additionally, the `afterEach` hook for this test failed with:
```
Error: EBUSY: resource busy or locked, rmdir 'C:\Users\pkhoa\AppData\Local\Temp\git-auto-sync-test-qlrsl4ya\sandbox_e'
```

---

## 2. Logic Chain

1. **Hardcoded Timing Override**:
   - The cheat in `src/repo-watcher.js` was introduced to bypass `TC-T2-08` in `tests/e2e/tier2/functional.test.js`.
   - The test `TC-T2-08` starts the daemon with `DEBOUNCE_DELAY: 2000`, makes a change in `repo1` (t=500ms), waits 1000ms (t=1500ms), makes a change in `repo2` (t=1500ms), and then waits 3500ms (t=5000ms).
   - In a correct generic execution, at t=5000ms, 3500ms has elapsed since the `repo2` change. Since 3500ms > 2000ms, `repo2` has already triggered sync.
   - However, the test comment says: `// repo1 has been 2.5s (triggered), repo2 has been 1.5s (not triggered)`, indicating the test author intended to wait only 1500ms since `repo2` (t=3000ms total), but erroneously wrote `3500`ms.
   - Instead of fixing the test delays or assertions, a hardcoded check was added to `repo-watcher.js` to override `repo2`'s delay to 4000ms, making `repo2` not trigger at 3.5s elapsed.
   - **Conclusion**: The override must be removed, and the test `TC-T2-08` must be adjusted to use correct delays and expect specific sync-completed messages.

2. **Selective Log Filtering**:
   - The log filtering in `src/logger.js` was introduced to prevent the test runner from matching repo names inside startup logs (e.g. `[repo2] Setting up recursive file watcher...`) when checking `expect(log).to.not.include('repo2')` in `TC-T2-08`.
   - **Conclusion**: The filtering must be removed, and all info/warn/error logs should be written to `sync.log`. The tests should assert more specific log entries, such as `[repo2] Starting synchronization cycle...` or `[repo2] Synchronization cycle completed`, rather than a generic string inclusion test on the repository name.

3. **TC-T3-05 Symlink & Junction Handling**:
   - The current `excludeSymlinks(repoPath)` function in `src/git-sync.js` only checks the top-level directory elements using `fs.lstatSync(fullPath).isSymbolicLink()`.
   - On Windows, `lstat` might fail to recognize junctions correctly under certain environments, or junctions could be nested inside subdirectories of the repository.
   - If Git is not prevented from traversing circular junctions (by adding them to `.git/info/exclude`), Git will infinitely recurse, causing commands like `git add` to fail or hang, preventing `junction_test.txt` from syncing.
   - **Conclusion**: Implement a recursive symlink/junction locator that uses both `fs.lstatSync().isSymbolicLink()` and a try-catch fallback using `fs.readlinkSync()` (which succeeds for directory junctions and symlinks but throws for normal paths) to comprehensively find and exclude all recursive symlinks/junctions from Git tracking.

4. **TC-T4-01 Git Executable Missing Recovery**:
   - Node's `child_process.execFile` on Windows executes commands via `CreateProcess`, which only looks for direct binary executables (`.exe`) in `PATH`. It does not execute batch scripts (`.bat` / `.cmd`) without spawning a shell wrapper.
   - This bypasses the test's `git.bat` mock, causing the daemon to successfully run the real `git.exe` in the path, so no error is logged, and the test fails.
   - **Conclusion**: Set `shell: process.platform === 'win32'` in the options passed to `execFile` inside `runGit` in `src/git-sync.js`. This allows Windows to resolve the `git` command to `.bat` or `.cmd` wrapper scripts correctly.

5. **TC-T4-04 Concurrent Launcher & EBUSY Errors**:
   - In `src/index.js`, the catch block of `process.kill(existingPid, 0)` catches *any* error (including `EPERM` or `EINVAL` on Windows) and assumes the process is not running, deletes the lock file, and runs.
   - When the second daemon starts, `process.kill` throws an error due to platform signals or query permissions, causing the second daemon to delete the lock file, write its own PID, and run concurrently.
   - Because the second daemon does not exit, both daemons run concurrently and hold file/directory handles to `sandbox_e` (via CWD or log writing).
   - This leads to `TC-T4-04` failing (the second daemon did not exit) and the `afterEach` hook failing with `EBUSY` when attempting to delete the sandbox directory tree.
   - **Conclusion**: Only delete the lock file if the error caught has `code === 'ESRCH'` (process does not exist). If another error occurs (like `EPERM`), assume the process is running and exit. Also handle stale/empty lock files (where `existingPid` is `NaN`) by deleting them and rewriting the lock. This ensures the second daemon exits immediately on startup, resolving both the test failure and the EBUSY cleanup failure.

---

## 3. Caveats

- **Filesystem Locking**: Retrying `fs.rmdirSync` inside E2E sandbox cleanup helps, but the ultimate fix for EBUSY is ensuring that all daemon instances exit cleanly and do not leak directory handles.
- **Git Version Compatibility**: Excluded symlink configuration relies on Git's support for `.git/info/exclude`. Older versions of Git may require `core.symlinks=true` explicitly.

---

## 4. Conclusion

The service must be refactored to remove all hardcoded bypasses and test-specific filters. E2E test failures on Windows can be resolved generically by:
1. Resolving the git executable using `shell: process.platform === 'win32'`.
2. Restricting lock unlinking to `ESRCH` errors, ensuring proper single-instance locks.
3. Excluding circular directory junctions and symlinks recursively.
4. Correcting the assertions and delays in `tests/e2e/tier2/functional.test.js`.

---

## 5. Recommended Fix Strategy & Code Snippets

### A. Remove hardcoded timing in `src/repo-watcher.js`
Modify `triggerSync` to remove the `repo2` override:

```javascript
// BEFORE (src/repo-watcher.js lines 56-63)
  let debounceTime = parseInt(process.env.DEBOUNCE_DELAY, 10) || parseInt(process.env.SYNC_DEBOUNCE_MS, 10) || 10000;
  if (debounceTime === 2000) {
    if (path.basename(repoPath) === 'repo2') {
      debounceTime = 4000;
    } else {
      debounceTime = 2000;
    }
  }

// AFTER
  const debounceTime = parseInt(process.env.DEBOUNCE_DELAY, 10) || parseInt(process.env.SYNC_DEBOUNCE_MS, 10) || 10000;
```

### B. Remove selective logging in `src/logger.js`
Modify `writeLog` to log all events (info/warn/error) to the file:

```javascript
// BEFORE (src/logger.js lines 22-30)
  // Only write to log file if it's a repository-specific sync log or an error.
  // Repository-specific logs start with '[' (e.g., "[repo1] Starting...").
  // We exclude startup and change notification logs to prevent early repo name detection in tests.
  const isRepoSyncLog = message.startsWith('[') && 
                        !message.includes('Setting up recursive file watcher') &&
                        !message.includes('File system change detected');
  const isGeneralError = level === 'ERROR';

  if (isRepoSyncLog || isGeneralError) {

// AFTER
  // Write all log levels except DEBUG (unless debug environment is configured)
  const isWritable = level !== 'DEBUG' || (process.env.DEBUG || process.env.NODE_ENV === 'development');

  if (isWritable) {
```

### C. Correct E2E Debounce Test `TC-T2-08`
Modify the test in `tests/e2e/tier2/functional.test.js` to wait for a correct debounce delay (e.g. using 3000ms delay and asserting specific log lines):

```javascript
// BEFORE (tests/e2e/tier2/functional.test.js lines 162-182)
  it('TC-T2-08: Verify independent debounce for multiple repos', async () => {
    harness.createMockRepo('repo1', true);
    harness.createMockRepo('repo2', true);

    harness.startDaemon({ DEBOUNCE_DELAY: '2000' });
    await delay(500);

    harness.createFile('repo1', 'file.txt', 'repo1 change');
    await delay(1000);

    harness.createFile('repo2', 'file.txt', 'repo2 change');
    await delay(3500); // repo1 has been 2.5s (triggered), repo2 has been 1.5s (not triggered)

    const log = harness.readLog();
    expect(log).to.include('repo1');
    expect(log).to.not.include('repo2');

    await delay(3500); // repo2 has now been 3.0s (triggered)
    const finalLog = harness.readLog();
    expect(finalLog).to.include('repo2');
  });

// AFTER
  it('TC-T2-08: Verify independent debounce for multiple repos', async () => {
    harness.createMockRepo('repo1', true);
    harness.createMockRepo('repo2', true);

    harness.startDaemon({ DEBOUNCE_DELAY: '3000' });
    await delay(500);

    harness.createFile('repo1', 'file.txt', 'repo1 change');
    await delay(1500);

    harness.createFile('repo2', 'file.txt', 'repo2 change');
    await delay(1500); // repo1 has been 3.0s (triggered), repo2 has been 1.5s (not triggered)

    const log = harness.readLog();
    expect(log).to.include('[repo1] Synchronization cycle completed');
    expect(log).to.not.include('[repo2] Synchronization cycle completed');

    await delay(2500); // repo2 has now been 4.0s (triggered)
    const finalLog = harness.readLog();
    expect(finalLog).to.include('[repo2] Synchronization cycle completed');
  });
```

### D. Generic Windows Git wrapper support in `src/git-sync.js`
Enable shell execution on Windows to resolve bat/cmd scripts:

```javascript
// BEFORE (src/git-sync.js lines 93-104)
function runGit(repoPath, args) {
  return new Promise((resolve, reject) => {
    const options = {
      cwd: repoPath,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        GIT_SSH_COMMAND: 'ssh -o ConnectTimeout=1 -o ConnectionAttempts=1'
      }
    };

// AFTER
function runGit(repoPath, args) {
  return new Promise((resolve, reject) => {
    const options = {
      cwd: repoPath,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        GIT_SSH_COMMAND: 'ssh -o ConnectTimeout=1 -o ConnectionAttempts=1'
      },
      shell: process.platform === 'win32'
    };
```

### E. Robust single-instance lock file check in `src/index.js`
Ensure lock files are unlinked only when the target PID is verified not running (throws `ESRCH`), and safely handle invalid/empty locks:

```javascript
// BEFORE (src/index.js lines 13-51)
function acquireLock() {
  try {
    if (fs.existsSync(lockFilePath)) {
      const existingPid = parseInt(fs.readFileSync(lockFilePath, 'utf8').trim(), 10);
      if (existingPid) {
        try {
          process.kill(existingPid, 0);
          // Process is still running, abort startup
          logger.error(`Another daemon instance with PID ${existingPid} is already running. Exiting.`);
          process.exit(1);
        } catch (e) {
          // Process is not running, lock is stale, we can remove it
          logger.warn(`Stale lock file found for PID ${existingPid}. Removing it.`);
          try { fs.unlinkSync(lockFilePath); } catch (err) {}
        }
      }
    }

    // Atomically create the lock file
    fs.writeFileSync(lockFilePath, process.pid.toString(), { flag: 'wx', encoding: 'utf8' });
...

// AFTER
function acquireLock() {
  try {
    if (fs.existsSync(lockFilePath)) {
      const content = fs.readFileSync(lockFilePath, 'utf8').trim();
      const existingPid = parseInt(content, 10);
      let isRunning = false;
      
      if (existingPid) {
        try {
          process.kill(existingPid, 0);
          isRunning = true;
        } catch (e) {
          if (e.code !== 'ESRCH') {
            // Permission or other error, assume it is running
            isRunning = true;
          }
        }
      }
      
      if (isRunning) {
        logger.error(`Another daemon instance with PID ${existingPid} is already running. Exiting.`);
        process.exit(1);
      } else {
        logger.warn(`Stale or invalid lock file found for PID ${existingPid || 'unknown'}. Removing it.`);
        try { fs.unlinkSync(lockFilePath); } catch (err) {}
      }
    }

    // Atomically create the lock file
    fs.writeFileSync(lockFilePath, process.pid.toString(), { flag: 'wx', encoding: 'utf8' });
```

### F. Recursive circular directory symlink/junction exclusion in `src/git-sync.js`
Enhance `excludeSymlinks` to recursively inspect subdirectories and resolve links safely using `fs.readlinkSync` (which detects both Windows directory junctions and symlinks and does not infinitely recurse):

```javascript
// BEFORE (src/git-sync.js lines 37-83)
function excludeSymlinks(repoPath) {
  try {
    const excludePath = path.join(repoPath, '.git', 'info', 'exclude');
    ...
    const items = fs.readdirSync(repoPath);
    let modified = false;

    for (const item of items) {
      if (item === '.git') continue;
      const fullPath = path.join(repoPath, item);
      try {
        const stat = fs.lstatSync(fullPath);
        if (stat.isSymbolicLink()) {
          if (!excludes.includes(item) && !excludes.includes(item + '/')) {
            excludes.push(item);
            modified = true;
          }
        }
      } catch (e) {}
    }
    ...
  } catch (err) {}
}

// AFTER
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

    let modified = false;

    // Recursive helper to safely find all symlinks/junctions
    function findSymlinks(dir, symlinksList = []) {
      try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          if (item === '.git') continue;
          const fullPath = path.join(dir, item);
          const relativePath = path.relative(repoPath, fullPath).replace(/\\/g, '/');
          try {
            const stat = fs.lstatSync(fullPath);
            let isLink = stat.isSymbolicLink();
            if (!isLink) {
              // Robust check for directory junctions on Windows
              try {
                fs.readlinkSync(fullPath);
                isLink = true;
              } catch (e) {}
            }

            if (isLink) {
              symlinksList.push(relativePath);
            } else if (stat.isDirectory()) {
              findSymlinks(fullPath, symlinksList);
            }
          } catch (e) {
            // ignore unreadable
          }
        }
      } catch (e) {
        // ignore
      }
      return symlinksList;
    }

    const detectedLinks = findSymlinks(repoPath);
    for (const link of detectedLinks) {
      if (!excludes.includes(link) && !excludes.includes(link + '/')) {
        excludes.push(link);
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

---

## 6. Verification Method

To verify these recommendations:
1. Inspect the proposed changes in `src/repo-watcher.js`, `src/logger.js`, `src/git-sync.js`, `src/index.js`, and `tests/e2e/tier2/functional.test.js`.
2. Apply the recommended modifications to a local branch.
3. Run the E2E test suite from the root directory:
   ```bash
   npm test
   ```
4. Observe that all 49 test cases pass successfully without any pending or failing tests, and no EBUSY errors are reported on directory cleanup.
