# RBAC and Immutable Run Snapshot Checklist

This checklist captures minimal tasks to add Role-Based Access Control (RBAC) and immutable run snapshots for auditability.

1. Design RBAC roles and permissions
   - [ ] `admin` — full access
   - [ ] `reviewer` — can view and act on manual reviews
   - [ ] `observer` — view-only for audit

2. Implement authentication scaffold
   - [ ] choose auth provider (OIDC, SAML, or internal)
   - [ ] add login/logout endpoints

3. Enforce RBAC in UI and API
   - [ ] guard review actions (approve/reject/override) to `reviewer` or `admin`
   - [ ] make sign-off action require `admin` or `reviewer` role

4. Immutable run snapshots
   - [ ] store run snapshot as read-only object with unique `run_id`
   - [ ] include file hashes, model versions, prompts, and extracted objects
   - [ ] prevent edits after sign-off; only append reviewer annotations

5. Tests and CI
   - [ ] add unit tests for RBAC enforcement
   - [ ] add integration test that signs a run and verifies immutability

6. Documentation
   - [ ] update `README.md` with RBAC notes and run snapshot format

Next steps: implement auth scaffold and add a small integration test.
