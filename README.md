# TenderWiseAI - Working Prototype

TenderWiseAI is a working web prototype for AI-assisted tender eligibility evaluation with explainable, criterion-level decisions.

## Live Website

Use the hosted working prototype here:

https://tenderwiseai-ctehgcdyh5hrbhca.centralindia-01.azurewebsites.net/

## What this prototype does

- Upload a tender document.
- Upload optional tender amendments (corrigenda/addenda).
- Upload bidder evidence files.
- Extract and normalize eligibility criteria.
- Review and approve criteria before evaluation.
- Evaluate each bidder criterion-by-criterion.
- Route ambiguous cases to manual review.
- Allow reviewer overrides with notes.
- Export a structured JSON report with audit information.

## Who this is for

- Procurement teams
- Tender evaluation committees
- Compliance and audit reviewers

The prototype is designed to improve speed and consistency while keeping final control with human reviewers.

## Supported file formats

Tender and amendment uploads:

- `.txt`
- `.pdf`
- `.doc`
- `.docx`
- image formats (`.png`, `.jpg`, `.jpeg`, `.tif`, `.tiff`, `.bmp`)

Bidder uploads:

- `.json`
- `.pdf`
- `.doc`
- `.docx`
- image formats (`.png`, `.jpg`, `.jpeg`, `.tif`, `.tiff`, `.bmp`)

## Evaluation outcomes

Each criterion returns one of:

- `Eligible`
- `Not Eligible`
- `Needs Manual Review`

The system also provides evidence-linked reasoning for each result.

## Typical workflow

1. Upload tender document.
2. Upload optional amendments.
3. Upload bidder files.
4. Review extracted criteria and approve.
5. Click `Run Evaluation`.
6. Review bidder results and manual-review queue.
7. Apply overrides if required.
8. Export report.

## Report contents

- Bidder-level summary
- Criterion-level verdicts and reasons
- Evidence references and locations
- Reviewer override details
- Audit trail events

## Run locally

If you want to run the prototype locally:

1. Install Node.js 18+.
2. Start the server:

```bash
node server.js
```

3. Open:

http://localhost:3000

## Current limitations

- Export is currently JSON only.
- Persistent storage is not fully implemented.
- In-document visual highlighting is limited.

## Planned features

- Role-based access control (RBAC) with roles for admin, reviewer, and observer
- Persistent database backend
- Full authentication integration
- PDF and Excel export formats
- Interactive document viewer with bounding-box highlighting

## Project documents

- Solution write-up: [SOLUTION.md](./SOLUTION.md)
- Walkthrough script: [VIDEO_SCRIPT.md](./VIDEO_SCRIPT.md)
- Development notes: [DEVELOPMENT.md](./DEVELOPMENT.md)
