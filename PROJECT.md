# Project: Git Auto-Sync Service

## Architecture
The Git Auto-Sync Service is a background service for Windows implemented in Node.js. It watches the root of `E:\` and all its level-1 subdirectories. For any directory that is a Git repository, it watches for file system changes, debounces them, and runs synchronization commands.

```
+-------------------------------------------------------------+
|                     Windows User Session                    |
|                                                             |
|  +--------------------+             +--------------------+  |
|  |    launcher.vbs    | ----------> |  src/index.js      |  |
|  | (Runs via Registry |             |  (Node.js Daemon)  |  |
|  |  HKCU Run Key)     |             +---------+----------+  |
|  +--------------------+                       |             |
|                                               v             |
|                                     +--------------------+  |
|                                     | src/repo-watcher.js|  |
|                                     +---------+----------+  |
|                                               |             |
|                                               v             |
|                                     +--------------------+  |
|                                     |  src/git-sync.js   |  |
|                                     +---------+----------+  |
|                                               |             |
|                                               v             |
|                                      [ Git Repos under E:\ ]|
+-------------------------------------------------------------+
```

### Components
1. **Daemon Launcher (`launcher.vbs`)**: A VBScript launcher that executes Node.js windowless, avoiding terminal flashes in the user's interactive session.
2. **Main Entry (`src/index.js`)**: Scans `E:\` and its level-1 subfolders to detect Git repositories, starts the watchers, and logs status.
3. **Repo Watcher (`src/repo-watcher.js`)**: Uses native Node.js recursive file watching (`fs.watch(..., { recursive: true })`) to track changes inside detected repos. Includes a debouncing mechanism.
4. **Git Sync Logic (`src/git-sync.js`)**: Executes Git commands (`git pull`, `git add`, `git commit`, `git push`) with error handling, credential helper checks, and non-interactive env variables.
5. **Logger (`src/logger.js`)**: Appends synchronization events and errors to `E:\git_auto_sync_service\sync.log`.
6. **Installer (`install.ps1`)**: Installs/registers the service via registry run key, enables GCM, and launches the service.
7. **Verification (`verify_sync.ps1`)**: Simulates file additions/modifications in a temporary repo to verify auto-sync behavior.

## Code Layout
- `src/index.js`
- `src/repo-watcher.js`
- `src/git-sync.js`
- `src/logger.js`
- `launcher.vbs`
- `install.ps1`
- `verify_sync.ps1`

## Milestones
| # | Track | Milestone Name | Scope | Dependencies | Status | Conversation ID |
|---|---|---|---|---|---|---|
| 1 | E2E Testing | E2E_TEST_INFRA | Create test runner, harness, and Tier 1-4 tests; publish `TEST_READY.md` | None | IN_PROGRESS | bc8e660d-be45-4288-bc48-582e745c89a5 |
| 2 | Implementation | IMP_CORE_LOGIC | Implement watcher, debounce queue, git sync logic, and logging | None | IN_PROGRESS | 9d71f29b-fbe8-4e6a-ab54-530f5c2101b5 |
| 3 | Implementation | IMP_WINDOWS_SETUP | Implement startup registration, GCM setup, launcher, and `install.ps1` | IMP_CORE_LOGIC | PLANNED | 9d71f29b-fbe8-4e6a-ab54-530f5c2101b5 |
| 4 | Implementation | IMP_E2E_PHASE1 | Run and pass all E2E tests from `TEST_READY.md` | E2E_TEST_INFRA, IMP_WINDOWS_SETUP | PLANNED | 9d71f29b-fbe8-4e6a-ab54-530f5c2101b5 |
| 5 | Implementation | IMP_E2E_PHASE2 | Conduct Tier 5 adversarial coverage and hardening | IMP_E2E_PHASE1 | PLANNED | 9d71f29b-fbe8-4e6a-ab54-530f5c2101b5 |

## Interface Contracts
### Main Entry ↔ Repo Watcher
- `watchRepositories(baseDir)`: Scans `baseDir` and level-1 folders. Begins watching Git repositories.
- Callback on change: Triggers `git-sync` queue.

### Repo Watcher ↔ Git Sync
- `triggerSync(repoPath)`: Enqueues a sync operation for the given repository path.
- Handles debouncing of 10 seconds per repository.

### Git Sync Execution
- Runs non-interactive git commands with variables `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never`.
- Safe command execution: if pull or push fails, logs it and continues.
