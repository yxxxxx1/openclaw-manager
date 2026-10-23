# Repository collaboration policy

## Local-first development and cloud CI budget

- The user's policy is to check development changes locally first across all projects. Use an isolated `codex/*` branch/worktree and preserve every existing checkout's unrelated changes.
- Create development PRs with `gh pr create --draft`. Keep them draft while iterating. Do not repeatedly push ready PRs or rerun whole cloud workflows as a substitute for local diagnosis.
- At an important checkpoint, complete the local checks below, record the exact tested SHA and results, then mark the PR ready. Ready PR updates, `main` pushes, explicit acceptance runs and release tags keep their existing cloud checks. Wait for the latest commit's required checks to pass before merging or releasing.
- If substantial development resumes after a checkpoint, return that PR to draft before pushing iterative changes. Do not change another task's PR state or cancel its current checks without authorization.
- Draft workflow jobs are intentionally skipped before allocating runners. A skipped/green draft workflow is NOT evidence of full verification. Never use `[skip ci]`, disable Actions, weaken an assertion, or bypass a failed/cancelled/missing checkpoint to save budget.
- Preserve exact-SHA provenance, immutable artifact digests, controlled migrations, permission boundaries, production serialization, recovery and post-release verification. Cost changes must not trigger a product deployment or a release tag.

### Local checks

For CI-policy-only or documentation-only edits, run the offline policy validator and review/validate the workflow diff locally. The app commands below apply when app/build inputs change; the ready/main cloud checkpoint still runs its original full suite.

- Run `python scripts/ci/check_workflow_policy.py` and `npm run build` locally first; use `npm ci` in a fresh checkout or after dependency changes.
- For Rust/native changes run `cargo check --manifest-path src-tauri/Cargo.toml` and applicable Rust tests with platform prerequisites available.
- The ready PR/main checkpoint must still build macOS, Windows and Linux. A local Windows build does not replace the other platform checks.
- A version tag must retain the complete build matrix before its release job. Do not cancel an in-progress tag release or replace release verification with a draft/skipped development run.
