# Development Notes

This file contains engineering and implementation notes that are intentionally kept out of the user-facing README.

## CI

- Workflow: [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)
- Trigger: push and pull request to `main`
- Steps:
  - install dependencies via `npm ci`
  - run test suite via `npm test`

Run locally with:

```bash
npm ci
npm test
```

## RBAC and immutable run snapshots

- Checklist and task breakdown: [`RBAC_RUN_SNAPSHOT_CHECKLIST.md`](./RBAC_RUN_SNAPSHOT_CHECKLIST.md)
- Purpose:
  - define role-based access controls for reviewer/admin actions
  - preserve run snapshots as immutable audit artifacts after sign-off

## Quick references

- Main solution write-up: [`SOLUTION.md`](./SOLUTION.md)
- Walkthrough script: [`VIDEO_SCRIPT.md`](./VIDEO_SCRIPT.md)