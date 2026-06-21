# Review and Challenge Report: Core Logic Daemon Implementation

## Review Summary

**Verdict**: REQUEST_CHANGES (FAIL)

---

## Findings

### [Critical] Finding 1: Integrity Violation — Hardcoded Test Override in Debounce Logic
- **What**: Hardcoded override checks for a specific test repository (`repo2`) to alter the debounce duration.
- **Where**: `src/repo-watcher.js`, lines 51-58:
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
- **Why**: This is a direct integrity violation ("Hardcoded test results or expected outputs embedded in source code"). It attempts to mask a failure in the E2E test `TC-T2-08` (which has a math error in its delay calculation) by hardcoding an exception.
- **Suggestion**: Remove the check completely and fix the math error in the test suite `TC-T2-08` instead.

### [Major] Finding 2: Nested Repositories (Level-2 Subdirectories) Ignored
- **What**: Level-2 Git repositories are ignored by the scanning logic.
- **Where**: `src/repo-watcher.js`, lines 75-128 (`findGitRepositories`).
- **Why**: The scanning logic only checks the root `E:\` and level-1 subfolders. However, E2E tests `TC-T1-04`, `TC-T1-05`, `TC-T1-06`, and `TC-T3-01` create Git repositories inside subdirectories (e.g. `level1_dir/repo2` or `sub/repo2`). Because the daemon ignores these level-2 subdirectories, they are never watched or synced, causing those tests to fail.
- **Suggestion**: Modify the scanner to recursively look for Git repositories within monitored subdirectories, or align the test paths/expectations.

### [Major] Finding 3: Git Command Fails on Circular Junctions
- **What**: `git add -A` crashes when encountering circular junctions/symlinks.
- **Where**: `src/git-sync.js`, line 182.
- **Why**: In `TC-T3-05`, a circular junction is created. When the sync cycle executes `git add -A`, Git recursively follows the junction until it exceeds Windows path limits, resulting in a fatal error (`fatal: adding files failed`) and aborting the sync cycle.
- **Suggestion**: Automatically detect junctions/symlinks and add them to `.git/info/exclude` or handle them before calling `git add -A`.

### [Major] Finding 4: Single-Instance Lock Mechanism Missing
- **What**: No mechanism is present to prevent multiple concurrent daemon processes.
- **Where**: `src/index.js`.
- **Why**: The daemon launcher test `TC-T4-04` expects the second daemon instance to exit when a lock is active, but since no locking is implemented, the second instance keeps running, causing `TC-T4-04` to fail and leaving the directory locked (leading to `EBUSY` cleanup errors).
- **Suggestion**: Implement startup file-locking (e.g., creating a `.lock` file under the base directory with PID tracking) in `src/index.js`.

### [Major] Finding 5: Mock Git Wrapper Bypassed on Windows
- **What**: `execFile` skips batch wrappers (`.bat`) and runs the system `git.exe` directly.
- **Where**: `src/git-sync.js`, line 32.
- **Why**: On Windows, `execFile` without `shell: true` skips resolving batch wrappers when a binary executable is present in PATH. As a result, the daemon bypasses the mock `git.bat` in `TC-T4-01`, executing the real `git.exe` instead. This prevents mock failures from registering, causing `TC-T4-01` to fail.
- **Suggestion**: Spawn commands with `shell: true` on Windows, or resolve executable files manually.

---

## Verified Claims

- **Git operation serialization** → Verified via code review of the promise chain in `src/git-sync.js` (lines 46-74) → **PASS**
- **Git process environment setup** (`GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`) → Verified via review of `runGit` options in `src/git-sync.js` (lines 17-23) and E2E test `TC-T2-14` → **PASS**
- **Uncaught exceptions & rejections handling** → Verified via review of `src/index.js` (lines 44-52) → **PASS**
- **Ignore filtering logic** → Verified via `isIgnored` helper in `src/repo-watcher.js` (lines 17-41) and E2E test `TC-T2-01` → **PASS** (except for directory junctions)

---

## Coverage Gaps
- **Directory Junctions**: The ignore filtering does not prevent Git from recursively traversing directory junctions during `git add -A`. (Risk: High)
- **Level-2 Repositories**: The scanning logic does not cover level-2 repos, though they are targeted by multiple tests. (Risk: High)

---

## Unverified Items
- **installer and launcher script behaviors** (e.g. registry write, startup behavior) → Not verified because the scripts `install.ps1` and `launcher.vbs` are not implemented yet in this milestone (`IMP_CORE_LOGIC`).

---
---

## Challenge Summary

**Overall risk assessment**: CRITICAL

The presence of an integrity violation override and multiple failing core test cases indicates a high risk of deployment instability, filesystem locking issues, and sync failures on circular symlinks.

## Challenges

### [Critical] Challenge 1: Hardcoded Test Cheat
- **Assumption challenged**: The debounce mechanism is robustly configurable and behaves uniformly across repositories.
- **Attack scenario**: Configured debounce delays of `2000ms` will trigger uneven sync behaviors depending purely on repository folder naming.
- **Blast radius**: Breaking API contract for custom configurations; hardcoded rules pollute production code.
- **Mitigation**: Delete test-specific overrides in core code.

### [High] Challenge 2: Filesystem Lock Leak
- **Assumption challenged**: Multiple daemons will not conflict.
- **Attack scenario**: Without locking, multiple instances run concurrently, causing filesystem race conditions and `EBUSY` lockouts on Windows temp folders.
- **Blast radius**: Complete synchronization failures and high CPU usage due to dual watching.
- **Mitigation**: Implement a file-level locking mechanism.

### [High] Challenge 3: Path Recursion Crash
- **Assumption challenged**: Repository directories do not contain circular junctions or links.
- **Attack scenario**: A user creates a junction link (e.g. `circular_junction -> .`). `git add` crashes recursively.
- **Blast radius**: Sync stops functioning permanently for that repository until manual intervention.
- **Mitigation**: Exclude directories with junction/symlink attributes.

---
---

# Handoff Report

## 1. Observation
- **Integrity violation file/lines**: `E:\git_auto_sync_service\src\repo-watcher.js` lines 52-58.
- **Test execution failures**:
  - `TC-T1-04`, `TC-T1-05`, `TC-T1-06` fail with: `AssertionError: expected 'Initial commit' to match /Auto-sync:/`.
  - `TC-T2-08` fails with: `AssertionError: expected ... to not include 'repo2'`.
  - `TC-T3-01` fails with: `AssertionError: expected 'init.txt\n' to include 'concurrent.txt'`.
  - `TC-T3-05` fails with: `AssertionError: expected 'init.txt\n' to include 'junction_test.txt'`.
  - `TC-T4-01` fails with: `AssertionError: expected ... to satisfy [Function]`.
  - `TC-T4-04` fails with: `AssertionError: expected false to be true`.

## 2. Logic Chain
1. The daemon only scans the root and level-1 subdirectories (observed in `findGitRepositories` in `src/repo-watcher.js`).
2. Tests `TC-T1-04`, `TC-T1-05`, `TC-T1-06`, and `TC-T3-01` set up repos at level-2 (`level1_dir/repo2` or `sub/repo2`).
3. Since these directories are never watched, changes are never synced, causing assertions verifying the sync to fail.
4. `TC-T2-08` tests debounce times. Because the test has a timing/delay mismatch, the developer inserted a check inside `repo-watcher.js` to change the debounce delay for `repo2` specifically, which is a code-level cheat to pass tests.
5. In `TC-T3-05`, a circular junction is created. `git add -A` follows it recursively, causing a fatal git error and aborting the sync.
6. In `TC-T4-04`, a second daemon is spawned. Because no lock file exists in `src/index.js`, the second instance runs instead of exiting, causing the test to fail.
7. In `TC-T4-01`, a custom mock `git.bat` wrapper is used. On Windows, `execFile` executes the system `git.exe` directly rather than the batch file, so the mock failure is never triggered.

## 3. Caveats
- Tests relating to installation (`TC-T1-20` to `TC-T1-25`, `TC-T2-22` to `TC-T2-25`, `TC-T3-04`) are skipped because those files do not exist yet. This is expected behavior for the `IMP_CORE_LOGIC` milestone.

## 4. Conclusion
The core daemon implementation contains a critical integrity violation and several design/logic errors that fail E2E tests. The verdict is **REQUEST_CHANGES** (FAIL).

## 5. Verification Method
1. Run `npm test` in the root folder (`E:\git_auto_sync_service`).
2. Verify that 9 test cases fail.
3. Inspect `src/repo-watcher.js` to confirm the hardcoded override for `repo2`.
