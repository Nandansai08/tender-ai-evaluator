# AI Tender Evaluator

AI-based tender evaluation and eligibility analysis for government procurement.

## What this is

This repository contains a working solution that demonstrates:

- tender criterion extraction from unstructured tender text
- bidder-by-bidder eligibility analysis
- criterion-level explainable verdicts
- explicit routing of ambiguous cases to manual review
- an audit trail of automated processing steps

This is an original solution built for the problem statement and not a wrapper around any existing procurement product. The current implementation is intentionally focused, runnable, and transparent so that evaluators can inspect every decision path.

## Deliverables covered

- Idea submission: [SOLUTION.md](./SOLUTION.md)
- Working solution/demo: static web app served by Node
- 5-minute walkthrough script: [VIDEO_SCRIPT.md](./VIDEO_SCRIPT.md)
- Code repository: this repo

## Solution scope

The current solution supports a representative scenario:

- one tender document in plain text
- multiple bidder submissions in JSON
- automatic extraction of four tender criteria:
  - minimum turnover
  - similar project experience
  - GST registration
  - ISO 9001 certification
- criterion-level verdicts:
  - `Eligible`
  - `Not Eligible`
  - `Needs Manual Review`
- evidence-backed decision explanations

## Tech choices

- Frontend: plain HTML, CSS, JavaScript
- Server: dependency-free Node HTTP server
- Dataset: mock tender text and bidder JSON files

This stack was chosen because it runs without package installation and is straightforward to evaluate, demonstrate, and extend.

## How to run

### Requirements

- Node.js 18+ installed

### Start the app

```bash
node server.js
```

Then open [http://localhost:3000](http://localhost:3000).

### Run tests

```bash
node tests/evaluator.test.js
```

## Deploy to Azure

The current app is already compatible with Azure App Service because `server.js` listens on `process.env.PORT`.

### Recommended hosting option

Use Azure App Service for the fastest path. This app is a simple Node.js web server, so it can run without refactoring.

### One-time Azure setup

1. Create a Web App in Azure App Service.
2. Choose:
   - Publish: `Code`
   - Runtime stack: `Node 20 LTS` or newer
   - Operating system: `Linux`
3. After the app is created, download the publish profile from the Azure portal.
4. In GitHub, add these repository secrets:
   - `AZURE_WEBAPP_NAME`: your Azure Web App name
   - `AZURE_WEBAPP_PUBLISH_PROFILE`: the full publish profile XML

### Continuous deployment

This repository includes a GitHub Actions workflow at `.github/workflows/azure-webapp.yml`.

After the two secrets are added, every push to `main` will:

- run `node tests/evaluator.test.js`
- deploy the app to Azure App Service

## Demo flow

1. Open the app.
2. Click `Load Sample Scenario`.
3. Review the extracted tender summary and criteria.
4. Click `Run Evaluation`.
5. Walk through each bidder result:
   - Alpha Builders: clearly eligible
   - Bravo Infra: clearly ineligible
   - Civic Structures: manual-review case due to low-confidence and conflicting evidence
6. Show the audit trail panel.

## Originality statement

This solution is original and was designed and implemented for this challenge. It is not based on or derived from an existing procurement evaluation product. The current implementation uses custom mock data, a custom evaluation flow, and transparent front-end logic built specifically for this submission.
