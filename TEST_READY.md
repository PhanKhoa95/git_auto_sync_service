# Test Readiness Report (E2E_TEST_INFRA)

The End-to-End (E2E) Test Suite and Infrastructure for the **Git Auto-Sync Service** have been fully implemented in accordance with `TEST_INFRA.md` and `PROJECT.md`.

## Test Infrastructure Components

1. **E2E Test Harness (`tests/e2e/harness.js`)**:
   - Manages a unique temporary sandbox representing virtual `E:\` (`TEST_E_DRIVE_PATH`) and remote bare Git repositories.
   - Configures and spawns the background Node.js daemon with specific environmental overrides (`DEBOUNCE_DELAY`, non-interactive Git environment variables).
   - Terminates the background processes cleanly using tree kill on Windows (`taskkill`).
   - Supports file creation, modification, deletion, renaming, log checking, and sandbox cleanups.

2. **Programmatic Test Runner (`tests/e2e/runner.js`)**:
   - Loads and runs the test suite programmatically using the Mocha API.
   - Configured with standard timeouts and colorized spec reporting.

3. **Mocha & Chai Integration (`package.json`)**:
   - `devDependencies` include `mocha` and `chai`.
   - Scripts configured:
     - `npm test` runs the programmatic E2E test runner (`node tests/e2e/runner.js`).
     - `npm run test:tier1` to `test:tier4` runs individual tiers.

## Test Case Inventory (60 Cases)

### Tier 1: Sanity & Smoke Tests (25 Cases) - `tests/e2e/tier1/sanity.test.js`
*   **TC-T1-01 to TC-T1-06**: Watcher CRUD event detection on root and level-1 sub-repositories.
*   **TC-T1-07 to TC-T1-08**: Ignoring changes in non-Git and level-2 directories.
*   **TC-T1-09**: Nested subdirectory creation detection.
*   **TC-T1-10 to TC-T1-11**: Debounce timing and queue hold behavior.
*   **TC-T1-12 to TC-T1-15**: Staging, auto-sync commit messages with timestamps, pushing to mock remote, and pull-before-push sequence.
*   **TC-T1-16 to TC-T1-19**: Error handling and logs check (no remote, git failures, error outputs in `sync.log`, repository deletion).
*   **TC-T1-20 to TC-T1-25**: Dry-run checks for setup scripts (`install.ps1`, `verify_sync.ps1`, launcher registry keys, windowless startup, and GCM helper configuration).

### Tier 2: Functional Tests (25 Cases) - `tests/e2e/tier2/functional.test.js`
*   **TC-T2-01 to TC-T2-06**: Ignore `.git/`, recursive watchers, `.gitignore` filtering, unreadable repository tolerance, simultaneous writes, and rename detection.
*   **TC-T2-07 to TC-T2-10**: Debounce reset on rapid inputs, isolated debounce across different repositories, single-commit buffering, and configurability.
*   **TC-T2-11 to TC-T2-15**: Commit message pattern validation, branch flexibility, pull-merge integration, non-interactive environment settings, and cached credential flow.
*   **TC-T2-16 to TC-T2-21**: Handling pull conflicts, `.git/index.lock` locks, network/push timeouts, permission errors, empty git repository init, and large 60MB file syncing.
*   **TC-T2-22 to TC-T2-25**: Installation pre-check for Node.js, log preservation during setup, launcher absolute path resolution, and `verify_sync.ps1` cleanup validation.

### Tier 3: Integration & System Tests (5 Cases) - `tests/e2e/tier3/integration.test.js`
*   **TC-T3-01**: Concurrent multi-repository watchers and separate debounces.
*   **TC-T3-02**: Complex pull-merge-commit-push sync with concurrent remote changes.
*   **TC-T3-03**: Network offline-to-online transitions with queue recovery.
*   **TC-T3-04**: Complete installer-to-runner execution cycle.
*   **TC-T3-05**: Handling of directory junctions and circular symlinks without recursion loops.

### Tier 4: Operational & Recovery Tests (5 Cases) - `tests/e2e/tier4/robustness.test.js`
*   **TC-T4-01**: Recovery behavior when the `git` executable is temporarily missing from `PATH` and then restored.
*   **TC-T4-02**: Skipping of corrupted repositories (invalid `.git/HEAD`) while keeping other watchers healthy.
*   **TC-T4-03**: Exception-safety during disk full/write-restricted log conditions.
*   **TC-T4-04**: Single-instance daemon lock/concurrency prevention.
*   **TC-T4-05**: Startup recovery of pending un-synced filesystem changes after a sudden process termination/crash.

---

## Executing the Test Suite

Install dependencies and run the tests:
```powershell
npm install
npm test
```
*Note: Some tests are skipped dynamically if the corresponding implementation scripts (e.g. `install.ps1`, `launcher.vbs`) are not yet present in the workspace. Tests targeting the daemon behavior will run and fail as expected until the core service (`src/index.js`) is implemented.*
