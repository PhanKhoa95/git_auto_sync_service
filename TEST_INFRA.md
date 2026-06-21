# E2E Test Infrastructure Design

This document defines the End-to-End (E2E) test infrastructure and test cases for the **Git Auto-Sync Service**. The service runs as a background process monitoring `E:\` and its level-1 subfolders for Git repository changes.

---

## 1. Test Philosophy & Strategy

To ensure that the Git Auto-Sync Service operates reliably on Windows without causing issues in the user's interactive session, the E2E test suite uses an **opaque-box, hermetic, and offline-first** approach:

*   **Opaque-Box Validation**: The test suite runs the actual daemon as a separate background process. It does not inspect the internal variables or mock internal functions. Instead, it interacts with the daemon purely by modifying files on the filesystem, starting/stopping the process, checking the output log file (`sync.log`), and verifying the state of Git repositories.
*   **Hermetic (Sandbox) Environment**: Tests must not touch the actual user's `E:\` drive or pollute the production environment. We virtualize the monitored drive using a temporary directory passed via an environment variable (`TEST_E_DRIVE_PATH`). The daemon will monitor this sandbox directory as if it were `E:\`.
*   **Offline-First (No External Remotes)**: To prevent flaky tests due to network issues, credential locks, or rate limits, the test runner initializes **local bare Git repositories** (`git init --bare`) to serve as mock remote origins. This allows verifying push/pull/fetch workflows locally at high speed.
*   **Deterministic Timing**: The daemon's debounce delay is made configurable (e.g., via a `DEBOUNCE_DELAY` environment variable). During testing, we shorten the debounce time (e.g., to 1–2 seconds) to keep the test suite execution fast.

---

## 2. Test Runner Architecture

The E2E test runner is implemented in Node.js using **Mocha** and **Chai**. 

```
+-------------------------------------------------------------------------+
|                              Test Runner                                |
|  - Spawns/terminates daemon process under test                          |
|  - Virtualizes drive via TEST_E_DRIVE_PATH                              |
|  - Sets up mock bare repositories as remote origins                    |
|  - Verifies assertions by checking git reflog, logs, and files          |
+----------------------------------+--------------------------------------+
                                   |
                                   | spawns with TEST_E_DRIVE_PATH
                                   v
+-------------------------------------------------------------------------+
|                          Daemon Under Test                              |
|  - Watches TEST_E_DRIVE_PATH (simulating E:\)                           |
|  - Performs git operations against local mock bare repositories          |
|  - Writes status and errors to sandboxed sync.log                       |
+-------------------------------------------------------------------------+
```

### The Test Harness (`tests/e2e/harness.js`)
The test suite utilizes a central helper class (`E2ETestHarness`) which manages the lifecycle of the test environment:
*   **`setupSandbox()`**: Creates a unique temp directory to act as the virtual `E:\` drive and a separate temp directory for bare remotes.
*   **`createMockRepo(name, hasRemote)`**: Initializes a local Git repo inside the virtual drive. If `hasRemote` is true, it also initializes a bare repo, sets it as the remote `origin`, and makes an initial commit.
*   **`startDaemon(envOverrides)`**: Spawns the Node.js daemon (`src/index.js`) as a child process using the virtual drive path, custom log path, and custom debounce delay.
*   **`stopDaemon()`**: Kills the daemon process cleanly and ensures all file handles are released.
*   **`cleanSandbox()`**: Deletes all temporary folders and files.

---

## 3. Directory Layout

The E2E test files are organized alongside the source code in accordance with the project layout guidelines:

```
E:\git_auto_sync_service\
├── src/                          # Application source code
│   ├── index.js
│   ├── repo-watcher.js
│   ├── git-sync.js
│   └── logger.js
├── tests/                        # Test suite directory
│   └── e2e/                      # E2E tests
│       ├── harness.js            # Setup/teardown helpers and mock controllers
│       ├── runner.js             # E2E test runner configuration
│       ├── tier1/                # Tier 1 Sanity/Smoke Tests (25 cases)
│       │   └── sanity.test.js
│       ├── tier2/                # Tier 2 Detailed Functional Tests (25 cases)
│       │   └── functional.test.js
│       ├── tier3/                # Tier 3 Integration/System Tests (5 cases)
│       │   └── integration.test.js
│       └── tier4/                # Tier 4 Robustness/Failure Recovery (5 cases)
│           └── robustness.test.js
├── launcher.vbs                  # VBScript runner
├── install.ps1                   # Installer script
├── verify_sync.ps1               # Post-install verification script
├── TEST_INFRA.md                 # E2E Test infrastructure design (this file)
└── PROJECT.md                    # Project blueprint and milestones
```

---

## 4. Mock Setup & Environmental Virtualization

### A. Monitored Drive Sandbox
The daemon reads its target watch path from the environment variable `TEST_E_DRIVE_PATH`. If not set, it defaults to the root of `E:\`.
*   **Normal run**: `node src/index.js` (watches `E:\`)
*   **Test run**: `TEST_E_DRIVE_PATH=C:\Users\...Temp\sandbox_e` (watches the temp folder)

### B. Mock Git Remote
Instead of pushing to GitHub/GitLab, the harness sets up local bare repositories:
1.  Initialize a bare repository: `git init --bare E:\temp_remotes\repo1.git`
2.  Initialize the local test repository: `git init E:\sandbox_e\repo1`
3.  Add origin: `git remote add origin E:\temp_remotes\repo1.git`
4.  Configure upstream branch: `git push --set-upstream origin master`

When the daemon runs `git push`, it pushes directly to the local folder `E:\temp_remotes\repo1.git`. The test runner verifies the push by inspecting `git log` or checking references in `E:\temp_remotes\repo1.git`.

### C. Registry Virtualization
During test runs for the installer (`install.ps1`), we redirect the Registry modification:
*   We pass a `-TestMode` flag to `install.ps1`.
*   In test mode, the script writes to `HKCU:\Software\Microsoft\Windows\CurrentVersion\Run\GitAutoSync_Test` instead of the live registry key.
*   The runner reads this key to verify that the launcher command path was constructed correctly, then deletes the test key.

### D. Non-Interactive Git Environment
To avoid blocking background execution on credentials or prompts, the test runner ensures the daemon executes git commands with:
*   `GIT_TERMINAL_PROMPT = 0` (prevents password/username prompts on CLI)
*   `GCM_INTERACTIVE = never` (instructs Git Credential Manager to fail immediately instead of opening login dialogues)

---

## 5. Feature Matrix & Identifiers

The test cases cover the 5 core features identified for the Git Auto-Sync Service:

*   **F1**: File Watcher & Change Detection
*   **F2**: Debounce Queue
*   **F3**: Git Sync Pipeline (Pull, Add, Commit, Push)
*   **F4**: Robustness & Graceful Error Handling
*   **F5**: Installer & Startup Configuration

---

## 6. E2E Test Case Inventory

### Tier 1: Sanity & Smoke Tests (25 Cases)

Tier 1 focuses on verifying basic CRUD operations, happy-path daemon behaviors, and installer syntax checks.

| Test ID | Feature | Title | Objective | Steps / Inputs | Expected Output |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-T1-01** | F1 | Detect file creation in root repo | Verify creating a file at the root of a monitored repo triggers detection. | 1. Start daemon on sandbox drive.<br>2. Create `E:\repo1\test1.txt`. | Watcher registers change event for `E:\repo1`. |
| **TC-T1-02** | F1 | Detect file modification in root repo | Verify modifying an existing file at the root of a monitored repo triggers detection. | 1. Start daemon.<br>2. Modify `E:\repo1\test1.txt`. | Watcher registers change event for `E:\repo1`. |
| **TC-T1-03** | F1 | Detect file deletion in root repo | Verify deleting a file at the root of a monitored repo triggers detection. | 1. Start daemon.<br>2. Delete `E:\repo1\test1.txt`. | Watcher registers change event for `E:\repo1`. |
| **TC-T1-04** | F1 | Detect file creation in level-1 repo | Verify file creation in a sub-repo (level-1) is detected. | 1. Start daemon.<br>2. Create `E:\level1_dir\repo2\test2.txt`. | Watcher registers change event for `E:\level1_dir\repo2`. |
| **TC-T1-05** | F1 | Detect file modification in level-1 repo | Verify file modification in a sub-repo (level-1) is detected. | 1. Start daemon.<br>2. Modify `E:\level1_dir\repo2\test2.txt`. | Watcher registers change event for `E:\level1_dir\repo2`. |
| **TC-T1-06** | F1 | Detect file deletion in level-1 repo | Verify file deletion in a sub-repo (level-1) is detected. | 1. Start daemon.<br>2. Delete `E:\level1_dir\repo2\test2.txt`. | Watcher registers change event for `E:\level1_dir\repo2`. |
| **TC-T1-07** | F1 | Ignore file creation in a non-git directory | Verify folders without a `.git` directory are ignored. | 1. Create non-git folder `E:\non_git_folder`.<br>2. Start daemon.<br>3. Create `E:\non_git_folder\file.txt`. | Watcher ignores change; no sync queue event is generated. |
| **TC-T1-08** | F1 | Ignore file creation in level-2 directory | Verify non-git folders at level-2 or deeper are ignored. | 1. Create structure `E:\folder\subfolder` (no git).<br>2. Start daemon.<br>3. Create `E:\folder\subfolder\file.txt`. | Watcher ignores change; no sync is triggered. |
| **TC-T1-09** | F1 | Detect subfolder creation in git repo | Verify creating a new folder inside a git repo is detected. | 1. Start daemon.<br>2. Create directory `E:\repo1\new_folder`. | Watcher registers change event for `E:\repo1`. |
| **TC-T1-10** | F2 | Trigger sync after debounce elapsed | Verify a single file modification triggers sync after debounce time. | 1. Start daemon (debounce = 5s).<br>2. Modify `E:\repo1\file.txt`. Wait 6s. | Sync starts exactly once. |
| **TC-T1-11** | F2 | Verify debounce queue holds changes | Verify debounce queue prevents instant execution on first change. | 1. Start daemon (debounce = 5s).<br>2. Modify `E:\repo1\file.txt`. Wait 2s. | Sync is not triggered yet. |
| **TC-T1-12** | F3 | Stage new untracked files | Verify `git add -A` is executed. | 1. Start daemon.<br>2. Create untracked file `E:\repo1\new.txt`. Wait for sync. | File is added to git index. |
| **TC-T1-13** | F3 | Commit created with automatic timestamp | Verify the commit message includes a timestamp. | 1. Start daemon.<br>2. Modify file. Wait for sync. | Commit message matches pattern: `Auto-sync: YYYY-MM-DD HH:MM:SS`. |
| **TC-T1-14** | F3 | Push to mock remote origin succeeds | Verify local commits are pushed to the remote. | 1. Configure local repo with mock bare remote.<br>2. Start daemon.<br>3. Modify file. Wait for sync. | Bare remote contains the new commit ref. |
| **TC-T1-15** | F3 | Pull from remote origin runs before pushing | Verify pulling updates from origin is the first step of sync. | 1. Start daemon.<br>2. Modify file. Wait for sync. | Sync log shows `git pull` executing before `git add` and `git commit`. |
| **TC-T1-16** | F4 | Daemon continues when repo has no remote | Verify missing remote origin is handled gracefully. | 1. Create repo with no remote configured.<br>2. Start daemon.<br>3. Modify file. Wait for sync. | Commit succeeds; log indicates push was skipped due to no remote; daemon remains active. |
| **TC-T1-17** | F4 | Daemon continues when git command fails | Verify a git command failure does not crash the daemon process. | 1. Cause git command to fail (e.g. invalid configuration).<br>2. Modify file. Wait for sync. | Daemon logs git failure and remains running. |
| **TC-T1-18** | F4 | Verify errors are written to sync.log | Verify daemon error logging. | 1. Trigger git failure (e.g. no write permissions on mock remote). | `E:\git_auto_sync_service\sync.log` contains git command error. |
| **TC-T1-19** | F4 | Handle repo deletion during debounce window | Verify deleting a repo folder during the debounce period is handled. | 1. Modify `E:\repo1\file.txt`.<br>2. Immediately delete `E:\repo1` directory before debounce ends. | Daemon skips repo, logs that path does not exist, and continues running. |
| **TC-T1-20** | F5 | Installer runs without syntax errors | Verify `install.ps1` executes correctly in test/dry-run mode. | 1. Execute `install.ps1 -TestMode`. | Installer completes with exit code 0. |
| **TC-T1-21** | F5 | Registry run key entries created | Verify installer writes to Registry Run key. | 1. Run `install.ps1 -TestMode`. | Key `HKCU:\Software\Microsoft\Windows\CurrentVersion\Run\GitAutoSync_Test` exists. |
| **TC-T1-22** | F5 | Registry entry references launcher | Verify registry key command points to the VBScript launcher. | 1. Read registry value for test key. | Command value is exactly `wscript.exe "E:\git_auto_sync_service\launcher.vbs"`. |
| **TC-T1-23** | F5 | Launcher runs windowless | Verify VBScript starts the node service silently. | 1. Run `wscript.exe launcher.vbs`. | Node process starts; no command prompt window appears. |
| **TC-T1-24** | F5 | Verify helper script verify_sync.ps1 runs | Verify verification script executes successfully. | 1. Run `verify_sync.ps1`. | Script completes, reports sync verification succeeded. |
| **TC-T1-25** | F5 | Verify GCM credential helper check | Verify installer checks GCM config. | 1. Run `install.ps1 -TestMode`. | Installer checks/sets global `credential.helper manager`. |

---

### Tier 2: Functional Tests (25 Cases)

Tier 2 focuses on detailed feature behavior, edge cases (ignores, renames), debounce logic nuances, and environment variables.

| Test ID | Feature | Title | Objective | Steps / Inputs | Expected Output |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-T2-01** | F1 | Ignore changes in `.git` directory | Ensure changes inside `.git` folder do not trigger sync loop. | 1. Start daemon.<br>2. Modify `E:\repo1\.git\config` or add `E:\repo1\.git\index.lock`. | No change detected; no sync triggered. |
| **TC-T2-02** | F1 | Detect changes inside nested directories | Verify recursive watching inside level-1 repos. | 1. Start daemon.<br>2. Create file `E:\repo1\sub1\sub2\deep.txt`. | Watcher registers change event for `E:\repo1`. |
| **TC-T2-03** | F1 | Ignore files matched by `.gitignore` | Verify gitignore files are not committed or pushed. | 1. Add `log/` to `.gitignore`.<br>2. Start daemon.<br>3. Create `E:\repo1\log\debug.log`. | File is ignored; no commit is made. |
| **TC-T2-04** | F1 | Watcher continues when a repo becomes unreadable | Ensure single repo watch failure does not stop other watch targets. | 1. Remove read permissions from `E:\repo2`.<br>2. Modify `E:\repo1\file.txt`. | `E:\repo1` syncs successfully. |
| **TC-T2-05** | F1 | Detect multiple files created simultaneously | Verify batch change handling. | 1. Start daemon.<br>2. Create 5 files simultaneously in `E:\repo1`. | Changes are bundled, resulting in a single sync event. |
| **TC-T2-06** | F1 | Detect file rename | Verify renames are committed correctly. | 1. Rename `E:\repo1\old.txt` to `E:\repo1\new.txt`. | Git stages rename (delete old, add new) and commits it. |
| **TC-T2-07** | F2 | Verify debounce reset on successive modifications | Ensure debounce timer resets on new events. | 1. Modify file at t=0s.<br>2. Modify at t=4s.<br>3. Modify at t=8s (debounce=10s). | Sync triggers at t=18s (10s after last modification). |
| **TC-T2-08** | F2 | Verify independent debounce for multiple repos | Verify repos have isolated debounce timers. | 1. Modify `E:\repo1` at t=0s.<br>2. Modify `E:\repo2` at t=5s (debounce=10s). | `repo1` syncs at t=10s; `repo2` syncs at t=15s. |
| **TC-T2-09** | F2 | Verify multiple rapid changes trigger single sync | Ensure multiple rapid writes generate only one commit. | 1. Start daemon.<br>2. Write to `E:\repo1\file.txt` 20 times in 5 seconds. | Only one commit is pushed to remote. |
| **TC-T2-10** | F2 | Verify debounce window is configurable | Verify configuration via environment variable. | 1. Set `DEBOUNCE_DELAY=3000` (3s).<br>2. Modify file. | Sync is triggered 3s after change. |
| **TC-T2-11** | F3 | Verify commit message format | Validate commit message matches template. | 1. Modify file. Wait for sync.<br>2. Retrieve commit message. | Commit message matches `/^Auto-sync: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/`. |
| **TC-T2-12** | F3 | Verify push works on non-main branches | Ensure branch flexibility. | 1. Checkout branch `feature-branch` in local repo.<br>2. Modify file. | Changes are pushed to remote branch `feature-branch`. |
| **TC-T2-13** | F3 | Verify pull performs merge | Ensure non-conflicting remote updates are fetched and merged. | 1. Commit `remote.txt` directly to remote origin.<br>2. Modify local file. Wait for sync. | Local repo merges `remote.txt` and pushes local commit. |
| **TC-T2-14** | F3 | Verify git terminal prompt env vars | Ensure environment variables prevent command prompts. | 1. Inspect spawned git process environment. | `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never` are set. |
| **TC-T2-15** | F3 | Verify push succeeds when credentials cached | Verify push completes successfully with cached GCM credentials. | 1. Run git push with cached GCM credentials. | Push executes and completes without prompt. |
| **TC-T2-16** | F4 | Handle merge conflicts gracefully during pull | Ensure daemon handles conflicting changes safely. | 1. Edit same line of same file locally and on remote.<br>2. Wait for sync. | Pull fails/stops due to conflict; error is logged; push is skipped; daemon remains active. |
| **TC-T2-17** | F4 | Handle `.git/index.lock` presence | Verify daemon handles lock files without crashing. | 1. Create dummy `.git/index.lock` in `E:\repo1`.<br>2. Modify file. Wait for sync. | Git command fails; daemon logs error and schedules retry or skips gracefully. |
| **TC-T2-18** | F4 | Handle network timeout during push/pull | Verify daemon does not hang on network disconnect. | 1. Configure remote to point to unresolvable IP.<br>2. Modify file. Wait for sync. | Git command times out; daemon logs network error and stays alive. |
| **TC-T2-19** | F4 | Handle permission denied errors | Ensure filesystem permissions do not crash daemon. | 1. Create write-protected file in git repository.<br>2. Attempt modification. | Exception is caught, logged, and daemon continues running. |
| **TC-T2-20** | F4 | Handle empty repository state | Verify initial commit creation in a new repository. | 1. Create new empty repo (no commits).<br>2. Add `first.txt`. Wait for sync. | Initial commit is created and pushed to origin. |
| **TC-T2-21** | F4 | Handle very large file addition | Verify sync of large file. | 1. Add a 60MB file to `E:\repo1`. | File is committed and pushed successfully (or logs warning if git limit hit, no crash). |
| **TC-T2-22** | F5 | Verify node installation check | Verify installer checks for Node.js. | 1. Remove Node.js path from environment.<br>2. Run `install.ps1`. | Installer exits with error: "Node.js is not installed". |
| **TC-T2-23** | F5 | Verify installer doesn't overwrite existing logs | Verify log preservation. | 1. Create `sync.log` with text.<br>2. Run `install.ps1 -TestMode`. | Existing log content remains intact. |
| **TC-T2-24** | F5 | Verify launcher starts daemon with absolute paths | Verify launcher resolves absolute paths. | 1. Run launcher from remote directory.<br>2. Check daemon working directory. | Working directory is resolved to `E:\git_auto_sync_service`. |
| **TC-T2-25** | F5 | Verify verify_sync.ps1 cleanup | Verify verification script cleans up after itself. | 1. Run `verify_sync.ps1`. | All temporary folders and dummy repositories are deleted. |

---

### Tier 3: Integration & System Tests (5 Cases)

Tier 3 tests end-to-end integration across multiple features, concurrent activities, and network state changes.

| Test ID | Feature | Title | Objective | Steps / Inputs | Expected Output |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-T3-01** | F1, F2, F3 | E2E multi-repository concurrent sync | Verify multiple repos watch, queue, and sync concurrently. | 1. Start daemon on sandbox.<br>2. Modify `E:\repo1\file.txt` and `E:\sub\repo2\file.txt` at same time. | Both repos queue their syncs, debounce independently, and push changes to their respective origins. |
| **TC-T3-02** | F1, F2, F3, F4 | E2E sync with remote updates | Verify full pull-merge-commit-push sequence. | 1. Push commit to remote.<br>2. Write local modification.<br>3. Wait for sync. | Local repo pulls and merges remote change, then commits and pushes local modification. |
| **TC-T3-03** | F1, F3, F4 | E2E offline-online transition | Verify sync recovery after network reconnect. | 1. Simulate offline state.<br>2. Modify local file (sync fails, logs error).<br>3. Restore network.<br>4. Modify file again. | Pull merges remote; both modifications are committed and pushed successfully. |
| **TC-T3-04** | F1, F2, F3, F5 | Full install-to-run flow | Verify setup script installs registry key and launches working daemon. | 1. Run `install.ps1 -TestMode`.<br>2. Launch daemon using VBScript.<br>3. Modify `E:\repo1\file.txt`. | File is successfully monitored, committed, and pushed. |
| **TC-T3-05** | F1, F3, F4 | Symlink and directory junction handling | Verify directory junctions or symlinks under `E:\` do not cause infinite loops. | 1. Create a circular directory junction inside `E:\repo1`.<br>2. Modify file. | Daemon handles structure safely, watches target repo without infinite recursion, and syncs successfully. |

---

### Tier 4: Operational & Recovery/Failure Tests (5 Cases)

Tier 4 tests robustness under extreme conditions: missing executables, filesystem corruption, disk full, duplicate instances, and recovery from sudden crashes.

| Test ID | Feature | Title | Objective | Steps / Inputs | Expected Output |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-T4-01** | F4 | Git executable missing recovery | Ensure daemon recovers once Git is restored to PATH. | 1. Temporarily remove `git` from PATH.<br>2. Modify file (sync fails, logs critical error).<br>3. Restore `git` to PATH.<br>4. Modify file. | Daemon logs Git missing warning but stays alive; once Git is restored, subsequent modifications sync successfully. |
| **TC-T4-02** | F4 | Corrupted `.git` directory | Verify daemon ignores/skips corrupt repos. | 1. Corrupt `E:\repo1\.git\HEAD`.<br>2. Modify `E:\repo1\file.txt`. | Sync fails; daemon logs git error and continues watching other repositories. |
| **TC-T4-03** | F4 | Disk full condition | Ensure daemon does not crash if disk writes fail. | 1. Simulate write failure or full disk (mock fs).<br>2. Modify file. | Daemon handles write exception gracefully without crashing the background process. |
| **TC-T4-04** | F5 | Concurrent launcher prevention | Ensure only one instance of the daemon runs at a time. | 1. Start daemon.<br>2. Run `launcher.vbs` again. | Second instance detects active process/lock and exits immediately. |
| **TC-T4-05** | F4, F5 | Recovery from sudden shutdown | Verify daemon syncs pending changes on startup. | 1. Modify file.<br>2. Kill daemon process before debounce/sync completes.<br>3. Restart daemon. | On startup, daemon checks repository status and commits/pushes the pending modifications. |

---

## 7. Verification and Test Suite Execution

The E2E test suite can be run manually or integrated into a CI/CD pipeline. 

### Prerequisites
*   Node.js v20.0.0 or higher
*   Git for Windows

### Running the E2E Tests
To run the entire test suite:
```powershell
# Install dev dependencies (Mocha and Chai)
npm install --save-dev mocha chai

# Run all test cases
npm test
```

To run a specific test tier:
```powershell
# Run Tier 1 Smoke tests
npx mocha tests/e2e/tier1/*.test.js

# Run Tier 4 Recovery tests
npx mocha tests/e2e/tier4/*.test.js
```
