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

- Tracked as a planned feature; see the open issue for role-based access
  control in the repository's issue tracker.
- Purpose:
  - define role-based access controls for reviewer/admin actions
  - preserve run snapshots as immutable audit artifacts after sign-off

## Quick references

- Main solution write-up: [`SOLUTION.md`](./SOLUTION.md)
- Walkthrough script: [`VIDEO_SCRIPT.md`](./VIDEO_SCRIPT.md)