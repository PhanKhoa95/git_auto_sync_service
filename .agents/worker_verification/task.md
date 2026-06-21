# Task Assignment: Run E2E Test Suite and Report Results

## Objective
Run the E2E test suite (`npm test`) in the workspace, collect the results, and document which tests pass, fail, or skip.

## Working Directory
`E:\git_auto_sync_service\.agents\worker_verification`

## Identity
- Archetype: teamwork_preview_worker
- Role: Test Suite Verifier
- Parent: E2E Testing Track sub-orchestrator

## Input
- E2E test suite in `tests/e2e/`
- Current implementation in `src/`

## Instructions
1. Run the test command `npm test` in `E:\git_auto_sync_service`.
2. Inspect the test execution output.
3. Generate a report in `progress.md` and `handoff.md` summarizing:
   - Total number of tests run
   - Number of passing tests
   - Number of failing tests (with a brief summary of failures)
   - Number of skipped tests
4. Check if the runner executed cleanups successfully.
5. Write `handoff.md` and report completion back to the parent.
