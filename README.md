# AI Tender Evaluator

AI-assisted tender eligibility evaluation with explainable, criterion-level decisions.

## Who this is for

This app is for procurement and review teams who need faster initial screening of bidder submissions while preserving human control, traceability, and auditability.

## What you can do

- Upload one tender and optional amendments/corrigenda.
- Upload bidder evidence files.
- Extract and review eligibility criteria before evaluation.
- Run bidder-wise evaluation with criterion-level outcomes:
  - `Eligible`
  - `Not Eligible`
  - `Needs Manual Review`
- Inspect evidence references (source file and page context).
- Override individual criterion outcomes with reviewer notes.
- Export a structured JSON report with review and audit metadata.

## Supported files

- Tender and amendments: `.txt`, `.pdf`, `.doc`, `.docx`, image formats.
- Bidder submissions: `.json`, `.pdf`, `.doc`, `.docx`, image formats.

## Quick start

1. Install Node.js 18+.
2. Start the app:

```bash
node server.js
```

3. Open [http://localhost:3000](http://localhost:3000).

## How to use

1. Click `Load Sample Scenario` for a ready-to-run demo, or upload your own files.
2. Confirm extracted criteria and approve them.
3. Click `Run Evaluation`.
4. Review outcomes, especially `Needs Manual Review` items.
5. Export the report.

## What the output includes

- Bidder-level overall recommendation.
- Criterion-level verdicts with reason text.
- Evidence references and location metadata.
- Reviewer overrides and notes.
- Audit trail events for key workflow actions.

## Current limitations

- Report export is currently JSON only.
- Persistence, authentication, and role-based access control are not fully implemented yet.
- Interactive in-document highlighting is not yet available.

## More details

- Full solution write-up: [SOLUTION.md](./SOLUTION.md)
- Demo walkthrough script: [VIDEO_SCRIPT.md](./VIDEO_SCRIPT.md)
- Developer notes: [DEVELOPMENT.md](./DEVELOPMENT.md)
