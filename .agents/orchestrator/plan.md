# Git Auto-Sync Service Hardening Plan

This plan details the milestones, tasks, and verification steps for hardening and optimizing the Git Auto-Sync Service.

## Architecture & Scope
The service consists of a background daemon (`src/index.js`, `src/repo-watcher.js`, `src/git-sync.js`, `src/logger.js`, `src/watchdog.js`) and a lightweight web dashboard (`src/dashboard.html`).

Our goal is to resolve memory leaks, prevent orphaned processes, avoid unhandled promise rejections, optimize the dashboard, and ensure 100% test pass rate for all 64 E2E test cases.

## Hardening Milestones

| # | Milestone Name | Scope | Status | Target Agent |
|---|---|---|---|---|
| 1 | HL_EXPLORE | Analyze codebase for memory leaks, process leaks, unhandled rejections, and dashboard unused code | PLANNED | explorer |
| 2 | HL_DAEMON | Implement fixes for watchers, debounce timers, process tracking/teardown, PID locking, and safe logging | PLANNED | worker |
| 3 | HL_DASHBOARD | Clean up dashboard UI, optimize API polling, remove unused code | PLANNED | worker |
| 4 | HL_VERIFY | Run E2E test suite (64 cases), verify memory stability, check process cleanup, run Forensic Auditor | PLANNED | challenger / reviewer / auditor |

## Detail Tasks

### Milestone 1: Exploration (HL_EXPLORE)
- Identify all Map/Set collections that hold repository-specific state.
- Trace the lifecycle of watchers and debounce timers to verify complete release on repo removal.
- Identify all `execFile`/`spawn` calls to see if child processes can be orphaned.
- Check all `.catch` and error handlers for unhandled rejections or unsafe property access (`err.error.message`).
- Identify unused code/CSS in `src/dashboard.html` and check API communication.

### Milestone 2: Daemon Hardening (HL_DAEMON)
- In `src/repo-watcher.js`: Clear and delete debounce timers in `stopWatchingRepo`.
- In `src/git-sync.js`: Track active child processes in a `Set` and kill them on daemon shutdown/cleanup.
- In `src/git-sync.js` / `src/repo-watcher.js`: Implement safe error formatting to prevent TypeError crashes during status checks, commits, and pushes.
- In `src/index.js` / `src/watchdog.js`: Correct `isDaemonProcessRunning` to check for `EPERM` (which indicates the process is running but signals are blocked) rather than treating it as inactive.
- In `src/index.js`: Handle request aborts/disconnects in `/api/clone` and `/api/publish` by terminating the git process.

### Milestone 3: Dashboard Cleanup & Optimization (HL_DASHBOARD)
- Clean up unused CSS classes, styles, and redundant scripts in `src/dashboard.html`.
- Optimize `/api/config` fetches to avoid redundant polling.
- Ensure the dashboard loads immediately on port 9999.

### Milestone 4: Verification (HL_VERIFY)
- Run the full E2E test suite (64 cases).
- Verify that no node/git processes remain active after tests.
- Verify memory stability.
- Run Forensic Auditor to ensure no integrity violations are introduced.
