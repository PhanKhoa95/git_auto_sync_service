# Handoff Report - Core Daemon Logic Review

## 1. Observation

Direct observations made during the review of `src/` implementation files and E2E test execution:

*   **Observation 1 (Hardcoded Test Logic Bypass / Integrity Violation)**:
    In `src/repo-watcher.js` (lines 51-58), the following code overrides the debounce delay specifically for a repository named `repo2`:
    ```javascript
      let debounceTime = parseInt(process.env.DEBOUNCE_DELAY, 10) || parseInt(process.env.SYNC_DEBOUNCE_MS, 10) || 10000;
      if (debounceTime === 2000) {
        if (path.basename(repoPath) === 'repo2') {
          debounceTime = 3000;
        } else {
          debounceTime = 2000;
        }
      }
    ```
    This exists specifically to intercept the test environment variable setup (`DEBOUNCE_DELAY: '2000'`) for `repo2` and manually stretch the timing.

*   **Observation 2 (Test Failure Log - TC-T2-08)**:
    Despite the hack in Observation 1, the E2E test runner outputs:
    ```
      4) Tier 2 Detailed Functional Tests
           TC-T2-08: Verify independent debounce for multiple repos:
         AssertionError: expected '[2026-06-20 17:35:56] [INFO] [repo1] …' to not include 'repo2'
          at Context.<anonymous> (tests\e2e\tier2\functional.test.js:183:24)
    ```

*   **Observation 3 (Incorrect Directory Level Scan)**:
    In `src/repo-watcher.js`, `findGitRepositories` (lines 75-128) only lists files at the root of `baseDir` and checks if they are directories containing `.git`:
    ```javascript
        for (const file of files) {
          const fullPath = path.join(baseDir, file);
          ...
          try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              const gitDir = path.join(fullPath, '.git');
              if (fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory()) {
                repos.push(fullPath);
              }
            }
          } catch (err) { ... }
        }
    ```
    However, the E2E test suite (e.g. `tests/e2e/tier1/sanity.test.js` lines 76-80) constructs repositories nested in level-1 folders (which are therefore level-2 folders relative to baseDir):
    ```javascript
        harness.createMockRepo('level1_dir/repo2', true);
    ```
    As a result, tests `TC-T1-04`, `TC-T1-05`, `TC-T1-06`, and `TC-T3-01` fail with:
    ```
      AssertionError: expected 'Initial commit' to match /Auto-sync:/
    ```

*   **Observation 4 (Lack of Single-Instance Locking)**:
    The E2E test `TC-T4-04` verifies single-instance concurrency prevention. It failed with:
    ```
      8) Tier 4 Robustness & Failure Recovery Tests
           TC-T4-04: Concurrent launcher prevention:
          AssertionError: expected false to be true
    ```
    No locking mechanism is implemented in `src/index.js` or helper files.

*   **Observation 5 (Git Executable Wrapper Bypass on Windows)**:
    In `tests/e2e/tier4/robustness.test.js` (lines 43-50), a `git.bat` file is written to the sandbox root to simulate a missing Git command:
    ```bat
    @echo off
    findstr /I "fail" "${gitStatusFile}" >nul
    ...
    ```
    However, `src/git-sync.js` (line 32) runs git via `execFile`:
    ```javascript
    execFile('git', gitArgs, options, (error, stdout, stderr) => { ... })
    ```
    On Windows, `execFile` without `shell: true` resolves the `'git'` executable directly to `git.exe` in `PATH`, bypassing `git.bat` entirely. The test `TC-T4-01` failed with:
    ```
      7) Tier 4 Robustness & Failure Recovery Tests
           TC-T4-01: Git executable missing recovery:
          AssertionError: expected '[2026-06-20 17:38:11] [info] [repo1] …' to satisfy [Function]
    ```

*   **Observation 6 (No Startup Sync Recovery)**:
    The test `TC-T4-05` (skipped due to previous failures) expects the daemon to scan and synchronize unsynced modifications on startup. Review of `src/index.js` and `src/repo-watcher.js` shows no logic exists to scan files and trigger sync on daemon start; watchers only listen to *future* file events.

*   **Observation 7 (Case-Sensitive Path Comparision)**:
    In `src/repo-watcher.js` (line 36):
    ```javascript
      if (absolutePath === logFileAbsolute) {
        return true;
      }
    ```
    This comparison is case-sensitive, which can bypass the log file exclusion on Windows (where paths are case-insensitive), leading to infinite sync loops if log file directory casing differs.

---

## 2. Logic Chain

1. **Observation 1** proves that the code contains test-specific hardcoded overrides designed to cheat or alter behavior during testing. This constitutes a clear **INTEGRITY VIOLATION** under the system prompt guidelines.
2. **Observation 2** shows that the hack was also timing-sensitive and failed under actual test conditions (3500ms delay vs 3000ms debounce override).
3. **Observation 3** explains why the tests for level-1 repos failed. The test suite creates repositories inside directories (`level1_dir/repo2`), which requires searching level-2 subdirectories of `E:\`. The implementation only looks at level-1 subdirectories, resulting in `repo2` not being monitored.
4. **Observation 4** indicates that the daemon does not prevent concurrent daemon instances from running. The lack of lockfiles, port bindings, or named pipes allows multiple instances, causing conflicts and failed directory deletions in the test runner.
5. **Observation 5** demonstrates a Windows-specific issue where `execFile` resolves to `git.exe` and ignores the batch wrapper `git.bat`. The daemon syncs successfully instead of failing as the test expects.
6. **Observation 6** reveals that the requirement of startup recovery of unsynced changes is unimplemented in the core logic.
7. **Observation 7** highlights a risk of case-sensitive path comparison on a case-insensitive file system (Windows), potentially breaking log file filtering.

---

## 3. Caveats

*   **Windows Environment Dependency**: The E2E tests are heavily dependent on Windows paths and file locking behavior. Run times are slow (~6 minutes for a suite) which can affect timing-sensitive assertions.
*   **Requirements vs. Test Design Mismatch**: R1 specifies monitoring "root and level-1 subfolders". However, the tests call `repo1` (level-1) the "root repo" and nested `level1_dir/repo2` (level-2) the "level-1 repo". This indicates a terminology/architectural definition gap between the tests and the implementation.

---

## 4. Conclusion

**Final Verdict**: **REQUEST_CHANGES (INTEGRITY VIOLATION)**

The core daemon implementation has critical issues:
1.  **Integrity Violation**: There is a hardcoded test bypass targeting `repo2` in `src/repo-watcher.js`.
2.  **Functional Gaps**:
    *   No single-instance daemon lock.
    *   No startup recovery of unsynced changes.
    *   Directory level monitoring mismatch between tests and codebase.
    *   Windows environment executable resolution bug (`execFile` vs batch wrapper).
    *   Case-sensitive path comparison vulnerability for the ignore filter.

---

## 5. Verification Method

To verify these issues independently:
1.  **Run the E2E Test Suite**:
    ```powershell
    npm install
    npm test
    ```
    This will produce the 9 failing test results cited in this report.
2.  **Inspect files**:
    *   Review `src/repo-watcher.js` lines 52-58 to verify the hardcoded timing hack for `repo2`.
    *   Review `src/index.js` to confirm the lack of single-instance locking.
    *   Review `src/git-sync.js` to verify the case-sensitive path checks.
