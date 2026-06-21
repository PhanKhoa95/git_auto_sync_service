# Task Assignment: Fix E2E Test Suite Robustness and Flakiness

## Objective
Fix the timing issues, environment check defects, and `EBUSY` file locking cleanup failures in the E2E test suite files under `tests/e2e/`.

## Working Directory
`E:\git_auto_sync_service\.agents\worker_fix_tests`

## Identity
- Archetype: teamwork_preview_worker
- Role: Test Suite Fixer
- Parent: E2E Testing Track sub-orchestrator

## Input
- `E:\git_auto_sync_service\tests\e2e/` (harness.js, sanity.test.js, functional.test.js, integration.test.js, robustness.test.js)
- Verification report from `.agents/worker_verification/handoff.md`

## Instructions
1. **Fix EBUSY lock issues on directory deletion**:
   - In `tests/e2e/harness.js`, the `removeDir` or `cleanSandbox` method should handle `EBUSY`/`EPERM` errors on Windows by retrying after a short delay (e.g., retry up to 5 times with a 200ms sleep in between).
   - Ensure that `stopDaemon()` fully terminates the process and waits a brief moment (e.g., 500ms) before returning, allowing Windows to release file handles.
2. **Fix TC-T2-14 parent vs. child env check**:
   - Change `TC-T2-14` to inspect the environment variables passed to the child process by the harness. You can store the `env` options used during `harness.startDaemon` in a field like `harness.daemonEnv`, and then assert that `harness.daemonEnv.GIT_TERMINAL_PROMPT === '0'` and `harness.daemonEnv.GCM_INTERACTIVE === 'never'`.
3. **Fix Timing Flakiness**:
   - In the test files (e.g., `sanity.test.js` and others), increase the wait delay from `1500ms` to at least `3000ms` or `4000ms` after filesystem changes to give Git operations on Windows enough time to complete.
   - Alternatively, implement a robust polling helper in the test files or in `harness.js` that checks for the expected condition (e.g., a log entry or the git commit message) every 500ms up to a timeout of 5 seconds.
4. Run the test suite (`npm test`) to verify that the tests are now stable (i.e. passing where the implementation is present, failing/skipping cleanly without aborting the suite due to hook errors).
5. Create `progress.md` and `handoff.md` in your directory and report completion.
