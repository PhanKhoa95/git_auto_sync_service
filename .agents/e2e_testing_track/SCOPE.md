# Scope: E2E Test Suite Development

## Architecture
The E2E test suite exercises the Git Auto-Sync Service as an opaque-box. The service is a background daemon running on Windows. The test suite simulates a Windows environment with Git repositories on the `E:\` drive (or virtualized test paths). It invokes file system changes, monitors Git sync outcomes (commits, pushes, logs), and tests service start/stop, installers, and edge cases.

### Components of E2E Test Suite
1. **Test Runner**: A Node.js-based or PowerShell-based runner that prepares the test environment, manages test repository setup, runs test cases, collects results, and generates reports.
2. **Mock Git Remote**: A local bare repository acting as the remote origin to verify pull and push operations.
3. **Mock File System Driver**: Simulates file additions, modifications, and deletions in Git repositories.
4. **Daemon Controller**: Starts and stops the daemon in a test configuration to verify startup, shutdown, and hot-reload behavior.

## Milestones
| # | Name | Scope | Dependencies | Status | Conversation ID |
|---|------|-------|-------------|--------|-----------------|
| 1 | Test Infrastructure Design | Define features, write `TEST_INFRA.md` outlining the test runner architecture, features, and test case layout | None | DONE | 8c668c30-261d-4ad7-bb22-111d737a5149 |
| 2 | Test Cases Development | Implement test cases for Tier 1 (25 tests), Tier 2 (25 tests), Tier 3 (5 tests), and Tier 4 (5 tests) | Test Infrastructure Design | PLANNED | |
| 3 | Test Runner & Verification | Create test runner script, stub/mock implementations to pass tests, verify the test suite passes on mock/stub | Test Cases Development | PLANNED | |
| 4 | Final E2E Publishing | Publish `TEST_READY.md` containing the test runner command and final coverage checklist | Test Runner & Verification | PLANNED | |

## Interface Contracts
### Test Runner ↔ Mock Git Remote
- The runner initializes bare repositories under a temporary path and sets them as `origin` for local test repositories.
- The runner queries the bare repository's git ref log or commit history to verify that push operations succeeded.

### Test Runner ↔ Daemon under Test
- The runner starts the daemon with custom env variables (e.g. `TEST_E_DRIVE_PATH` or targeting a test directory representing the monitored drive).
- The runner checks the daemon's log file (`sync.log`) and git history to verify synchronization correctness.
