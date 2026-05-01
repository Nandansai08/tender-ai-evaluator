# 5-Minute Video Walkthrough Script

## 1. Opening - 30 seconds

This is our AI Tender Evaluator, an original solution for AI-based tender evaluation and eligibility analysis in government procurement. Tender eligibility checks are currently manual, slow, inconsistent, and difficult to audit, especially when bidder submissions include scanned files and mixed document formats.

## 2. Solution overview - 45 seconds

Our solution has four steps:

1. Ingest the tender and bidder documents.
2. Extract structured eligibility criteria from the tender.
3. Match bidder evidence against each criterion.
4. Produce explainable outputs as `Eligible`, `Not Eligible`, or `Needs Manual Review`.

The key design principle is that the system never silently disqualifies on uncertain evidence. Ambiguous cases are explicitly surfaced for human review.

## 3. Architecture - 45 seconds

In this solution, we use a lightweight front end and a small Node server. The app loads a mock tender and mock bidder files, extracts normalized criteria, and then evaluates each bidder using transparent rule logic.

In the full version, this same flow extends to OCR, scanned documents, semantic retrieval, and a governed audit trail for procurement officers.

## 4. Live demo - 2 minutes

1. Open the app.
2. Click `Load Sample Scenario`.
3. Show the tender summary and extracted criteria.
4. Click `Run Evaluation`.
5. Show Alpha Builders as a clearly eligible bidder.
6. Show Bravo Infra as a clearly ineligible bidder.
7. Show Civic Structures as a manual-review case caused by low-confidence and conflicting evidence.
8. Show the audit trail panel and explain that every automated step is logged.

## 5. Closing - 45 seconds

This solution demonstrates the core idea: using AI-assisted extraction plus explainable rule evaluation to speed up procurement screening without losing accountability. It is original and intentionally designed so that unclear evidence is escalated to a human reviewer instead of being silently rejected.
