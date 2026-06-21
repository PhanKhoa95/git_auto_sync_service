# Task Assignment: E2E Test Suite Implementation

## Objective
Implement the test harness and E2E test cases (Tiers 1-4) for the Git Auto-Sync Service, in accordance with the design documented in `E:\git_auto_sync_service\TEST_INFRA.md`.

## Working Directory
`E:\git_auto_sync_service\.agents\worker_tests`

## Identity
- Archetype: teamwork_preview_worker
- Role: Test Suite Developer
- Parent: E2E Testing Track sub-orchestrator

## Input
- `E:\git_auto_sync_service\ORIGINAL_REQUEST.md`
- `E:\git_auto_sync_service\PROJECT.md`
- `E:\git_auto_sync_service\TEST_INFRA.md`

## Instructions
1. Implement the test harness helper in `tests/e2e/harness.js`. It must manage:
   - Creating sandbox folder using `TEST_E_DRIVE_PATH`.
   - Initializing local bare Git repositories to act as remotes.
   - Spawning and terminating the Node.js daemon (which will be at `src/index.js`).
   - Logging and cleaning up temp folders.
2. Implement 60 test cases as defined in `TEST_INFRA.md`:
   - `tests/e2e/tier1/sanity.test.js`: TC-T1-01 to TC-T1-25 (25 tests)
   - `tests/e2e/tier2/functional.test.js`: TC-T2-01 to TC-T2-25 (25 tests)
   - `tests/e2e/tier3/integration.test.js`: TC-T3-01 to TC-T3-05 (5 tests)
   - `tests/e2e/tier4/robustness.test.js`: TC-T4-01 to TC-T4-05 (5 tests)
3. Use Mocha and Chai for writing the test files.
4. Ensure files are written in their correct target paths under `tests/e2e/`.
5. Run npm init or create/update `package.json` to configure dependencies: `mocha`, `chai` as devDependencies, and a `test` script running the test suite.
6. MANDATORY INTEGRITY WARNING: DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
7. Create `progress.md` and `handoff.md` in your directory (`E:\git_auto_sync_service\.agents\worker_tests`) and communicate your completion when done.
