# Task Assignment: E2E Test Suite Verification and Cleanup (Replacement)

## Objective
Verify the integrity and correctness of the E2E test suite, clean up any stale environments/processes, run the tests, and report the results. If there are any remaining issues, fix them under `tests/e2e/`.

## Working Directory
`E:\git_auto_sync_service\.agents\worker_verify_and_cleanup_2`

## Identity
- Archetype: teamwork_preview_worker
- Role: Test Suite Verifier & Cleaner
- Parent: E2E Testing Track sub-orchestrator

## Input
- E2E test suite under `tests/e2e/`
- Implementation in `src/`

## Instructions
1. Kill any lingering background node or git processes from previous runs.
2. Delete any leftover temp sandbox directories (starting with `git-auto-sync-test-`) from WindowsTemp.
3. Run the complete E2E test suite (`npm test`).
4. Analyze the results:
   - Identify which tests pass, fail, or skip.
   - Explain why tests fail (is it due to missing installer script files, timing, or daemon bugs?).
   - If you encounter any remaining test design defects or test flakiness, apply fixes directly to the files in `tests/e2e/`.
5. Ensure the tests complete without hook errors or premature suite aborts.
6. Write a detailed `handoff.md` and report completion back to the parent.
