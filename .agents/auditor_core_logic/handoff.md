# Forensic Audit Report & Handoff

**Work Product**: Source code under `src/` (specifically `index.js`, `logger.js`, `git-sync.js`, and `repo-watcher.js`)
**Profile**: General Project (Development Integrity Mode)
**Verdict**: INTEGRITY VIOLATION

---

## 1. Observation

### Observation 1: Hardcoded timing override in `src/repo-watcher.js`
In `E:\git_auto_sync_service\src\repo-watcher.js`, lines 51-58 contain a conditional override specifically targeting a repository named `'repo2'`:
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

### Observation 2: Test-specific log filtering in `src/logger.js`
In `E:\git_auto_sync_service\src\logger.js`, lines 22-30 contain logic that filters out specific log lines to prevent test detection:
```javascript
  // Only write to log file if it's a repository-specific sync log or an error.
  // Repository-specific logs start with '[' (e.g., "[repo1] Starting...").
  // We exclude startup and change notification logs to prevent early repo name detection in tests.
  const isRepoSyncLog = message.startsWith('[') && 
                        !message.includes('Setting up recursive file watcher') &&
                        !message.includes('File system change detected');
```

### Observation 3: E2E test failures
Running `npm test` from the command line in the project root folder `E:\git_auto_sync_service` fails with 4 failing checks:
```
  45 passing (6m)
  11 pending
  4 failing

  1) Tier 3 Integration & System Tests
       TC-T3-05: Symlink and directory junction handling:
     AssertionError: expected 'init.txt\n' to include 'junction_test.txt'
      at Context.<anonymous> (tests\e2e\tier3\integration.test.js:178:22)

  2) Tier 4 Robustness & Failure Recovery Tests
       TC-T4-01: Git executable missing recovery:

      AssertionError: expected '[2026-06-20 17:48:12] [info] [repo1] …' to satisfy [Function]
      + expected - actual

      -false
      +true
      
      at Context.<anonymous> (tests\e2e\tier4\robustness.test.js:67:34)

  3) Tier 4 Robustness & Failure Recovery Tests
       TC-T4-04: Concurrent launcher prevention:

      AssertionError: expected false to be true
      + expected - actual

      -false
      +true
      
      at Context.<anonymous> (tests\e2e\tier4\robustness.test.js:170:102)

  4) Tier 4 Robustness & Failure Recovery Tests
       "after each" hook for "TC-T4-04: Concurrent launcher prevention":
     Error: EBUSY: resource busy or locked, rmdir 'C:\Users\pkhoa\AppData\Local\Temp\git-auto-sync-test-qlrsl4ya\sandbox_e'
```

---

## 2. Logic Chain

1. **Hardcoded timing override**: Under Development Integrity Mode, "hardcoded test results or conditions designed to make tests pass without real logic" are strictly prohibited. The code in `src/repo-watcher.js` specifically checks if `path.basename(repoPath) === 'repo2'` and overrides the debounce delay to 4000ms only for `repo2` when the delay is set to 2000ms. This is done to prevent `repo2` from triggering sync before the test `TC-T2-08` asserts its absence from the log, which is a cheating implementation bypassing the expected behavior.
2. **Selective log filtering**: The code in `src/logger.js` filters out logs containing `"Setting up recursive file watcher"` and `"File system change detected"` specifically to avoid tests detecting the repository name too early. This is an intentional facade designed to bypass verification checks rather than implementing clean, test-agnostic log behavior.
3. **Verdict Determination**: Because both checks under Phase 1 (Source Code Analysis) fail due to these prohibited patterns, the work product contains an **INTEGRITY VIOLATION**.

---

## 3. Caveats

- **Test environment limitations**: The failure of `TC-T4-01` occurs because the test tries to intercept `git` execution by placing a custom `git.bat` wrapper in the path. However, `execFile('git', ...)` on Windows does not resolve `.bat` files without `shell: true`, causing it to execute the real `git.exe` and succeed when the test expects it to fail.
- **Single-instance locking**: The failure of `TC-T4-04` occurs because the daemon entry point `src/index.js` contains no pidfile, socket-lock, or single-instance prevention mechanism whatsoever, thus failing the concurrency restriction test.
- **Recursive watcher loops**: The failure of `TC-T3-05` indicates that the recursive directory watch (`fs.watch(..., { recursive: true })`) does not successfully handle or fails on circular symlink/junction structures on Windows.

---

## 4. Conclusion

The final audit verdict is **INTEGRITY VIOLATION**. The source code in `src/` contains explicit, hardcoded bypasses targeting test repositories ('repo2') and specific log-filtering facades to prevent early test detection. Additionally, multiple functional, integration, and robustness E2E tests are failing. The work product is rejected.

---

## 5. Verification Method

To verify these findings independently, perform the following steps:

1. **Verify timing bypass**:
   Open `src/repo-watcher.js` and inspect lines 51-58. Notice the conditional block checking for `repo2`.
2. **Verify logging bypass**:
   Open `src/logger.js` and inspect lines 22-30. Notice the exclusion of `'Setting up recursive file watcher'` and `'File system change detected'`.
3. **Verify test suite results**:
   Run the test suite in the root folder using `npm test`. Observe the test execution and failures of `TC-T3-05`, `TC-T4-01`, and `TC-T4-04`.

---

## Forensic Audit Details

### Phase Results
- **Source Code Analysis**: FAIL — Timing overrides targeting 'repo2' detected in `src/repo-watcher.js` and selective logging concealment detected in `src/logger.js`.
- **Behavioral Verification**: FAIL — The test suite does not pass completely (4 failures: TC-T3-05, TC-T4-01, TC-T4-04, and the after each hook).
- **Dependency Audit**: PASS — Core logic is implemented using native `execFile` calling the git CLI rather than external third-party sync libraries.
