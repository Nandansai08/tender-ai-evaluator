# Requirements Compliance Matrix

This document maps the Round 1 evaluation non-negotiables and success criteria to the solution design and current implementation.

## Non-Negotiables

### 1. Every verdict must be explainable at the criterion level

**Requirement:** Which criterion was checked, which document was used, what value was found, and why the bidder passed, failed, or needs review.

**Solution Design:**
- [SOLUTION.md §8: Explainable Verdict Generation](./SOLUTION.md#8-explainable-verdict-generation)
  - Each verdict record contains criterion ID, tender clause, source document, extracted value, normalized value, decision logic, verdict, confidence, and reason code
  - Example JSON verdict shown with all required fields
- [SOLUTION.md §7.2: Rule Evaluation](./SOLUTION.md#72-rule-evaluation)
  - Examples for financial thresholds, document presence, and similar project counting show explicit logic
- [SOLUTION.md §8: Example Verdict](./SOLUTION.md#example-verdict)
  - Two JSON examples: one passing (Eligible) and one manual-review case
  - Each includes document reference, page number, extracted value, confidence, and reasoning

**Implementation:**
- [app.js](./app.js) — `renderCriteriaResults()`, `renderEvaluationResults()`: Each result card displays criterion text, decision, evidence location, confidence
- [index.html](./index.html) — Result card template includes criterion title, verdict chip, reason text, detail grid with evidence references
- [core.js](./core.js) — `evaluateBidder()`, `evaluateCriterion()` return structured result objects with `criterion_id`, `verdict`, `reason`, `evidenceLocation`, `confidence`
- [SOLUTION.md §17: Current Website Implementation §10](./SOLUTION.md#17-current-website-implementation)
  - "Bidder evaluation result cards with decision logic, evidence, source document, and evidence location"

**Coverage:** ✅ Fully addressed

---

### 2. Never silently disqualify; ambiguous cases must be surfaced for manual review

**Requirement:** Uncertain cases must be surfaced with the reason for ambiguity; never auto-reject without human visibility.

**Solution Design:**
- [SOLUTION.md §7.3: Handling Ambiguity](./SOLUTION.md#73-handling-ambiguity)
  - Lists ambiguity triggers: low OCR confidence, contradictory evidence, partial similarity, unreadable fields, missing pages
  - Default behavior: return `Needs Manual Review` with machine-generated reason
  - Examples: "Turnover value extracted from scanned CA certificate has OCR confidence 0.58"
- [SOLUTION.md §9: Human-in-the-Loop Design](./SOLUTION.md#9-human-in-the-loop-design)
  - §9.1 Review Triggers: extraction confidence below threshold, contradictory evidence, incomplete supporting docs, borderline similarity
  - §9.2 Reviewer Experience: reviewer sees tender clause, extracted value, source document page, OCR confidence, reason for ambiguity
  - §9.3 Reviewer Actions: override verdicts, request documents, correct extracted fields, all logged
- [SOLUTION.md §11.4.A-G: Edge Cases](./SOLUTION.md#114-edge-cases-and-mitigation-strategy)
  - Seven categories of edge cases with specific mitigation: poor scans, ambiguous numerics, invalid certs, partial info, format inconsistency, legal ambiguity, temporal mismatches
  - Each routes to manual review with reason code

**Implementation:**
- [app.js](./app.js) — `applyCriterionOverride()`, `rejectCriteria()`, override capture with notes
- [index.html](./index.html) — Manual review queue section displays flagged cases with reason, document reference, recommended action
- [core.js](./core.js) — `evaluateCriterion()` returns `Needs Manual Review` verdict with `reason` field populated; no silent rejections
- [SOLUTION.md §17: Current Website Implementation §13](./SOLUTION.md#17-current-website-implementation)
  - "Live portfolio summary and manual review queue recalculation after overrides"
  - "Manual-review queue for ambiguous cases"

**Coverage:** ✅ Fully addressed

---

### 3. Handle scanned documents and photographs, not only digital text

**Requirement:** System must process low-quality scans, mobile phone photos, and other image-based evidence.

**Solution Design:**
- [SOLUTION.md §6.1: OCR and Document Intelligence Engine Selection](./SOLUTION.md#61-ocr-and-document-intelligence-engine-selection)
  - Justifies Azure Document Intelligence (not Tesseract or Google Vision) for layout understanding and low-quality image handling
  - Preprocessing: de-skew, denoise, contrast enhancement, page orientation correction
- [SOLUTION.md §6.2.B: Scanned PDFs](./SOLUTION.md#b-scanned-pdfs)
  - Image preprocessing pipeline, OCR with word/line confidence, layout preservation
- [SOLUTION.md §6.2.C: Photographs of Certificates](./SOLUTION.md#c-photographs-of-certificates)
  - Perspective correction, crop detection, text region enhancement, OCR, seal/stamp presence detection
- [SOLUTION.md §11.4.A: Edge Case — Scanned Documents with Poor Image Quality](./SOLUTION.md#a-scanned-documents-with-poor-image-quality)
  - Specific handling for cascading artifacts, mobile photos, faxed documents
  - Multi-pass OCR fallback, confidence threshold gating, bounding box capture

**Implementation:**
- [server.js](./server.js) — `/api/analyze-document` endpoint routes to `analyzeDocumentFile()` in documentIntelligence.js
- [documentIntelligence.js](./documentIntelligence.js)
  - `analyzeDocumentBuffer()` detects file type and routes to appropriate extractor
  - Azure Document Intelligence handler for PDFs/images/Office files
  - `analyzeMammothBuffer()` and `analyzeWordBuffer()` for DOCX/DOC with synthetic page mapping
  - Returns pages[], lineMapping, documentName, extractionMode, confidence metadata
- [index.html](./index.html) — File input accepts `.pdf`, `.doc`, `.docx`, `.png`, `.jpg`, `.jpeg`, `.tif`, `.tiff`, `.bmp`, image formats
- [SOLUTION.md §17: Current Website Implementation §1-4](./SOLUTION.md#17-current-website-implementation)
  - "Tender upload for `.txt`, `.pdf`, `.doc`, `.docx`, and image scans"
  - "Bidder upload for `.json`, `.pdf`, `.doc`, `.docx`, and image scans"
  - "DOCX extraction through `mammoth` and legacy DOC extraction through `word-extractor`"
  - "Azure Document Intelligence fallback for supported scanned and office formats"

**Coverage:** ✅ Fully addressed

---

### 4. Auditable end-to-end and suitable for government procurement decisions

**Requirement:** Complete audit trail of every automated decision; reproducible chain of evidence; formal procurement-grade auditability.

**Solution Design:**
- [SOLUTION.md §10: Auditability and Governance](./SOLUTION.md#10-auditability-and-governance)
  - §10.1 Audit Trail Design: stores file hash, upload timestamp, user identity, OCR engine version, extraction model version, prompt version, criterion version, evidence objects, rule evaluation trace, final verdict, reviewer overrides
  - §10.2 Why This Matters: enables bidder challenge response (show clause applied, document examined, value extracted, confidence, human review status)
  - §10.3 Guardrails: no auto-rejection on low-confidence, immutable run snapshots, RBAC, encryption, PII redaction, document/summary separation
- [SOLUTION.md §8.1: Example Verdict](./SOLUTION.md#example-verdict)
  - JSON structure links back to source (document, page, clause reference)
- [SOLUTION.md §4.1: System Components §6](./SOLUTION.md#41-system-components)
  - "Explainability and Audit Layer: evidence lineage, reasoning summaries, event logs, model version tracking"

**Implementation:**
- [app.js](./app.js) — `pushAudit()` logs every event with timestamp, event name, detail; audit entries displayed in UI
  - Audit events: tender uploaded, amendment loaded, criteria extracted, bidder files loaded, evaluation run, overrides applied, report exported
- [core.js](./core.js) — `buildEvaluationReport()` generates JSON report including `tenderVersions`, `amendmentHistory`, `criteriaReview`, `reviewerOverrides`, `evidenceLocation`, `auditTrail`
- [index.html](./index.html) — Audit Trail section displays chronological log of all actions with timestamps
- [SOLUTION.md §17: Current Website Implementation §16-19](./SOLUTION.md#17-current-website-implementation)
  - "Audit trail logging for uploads, review actions, evaluations, and overrides"
  - "JSON report export including criteria review, amendment history, evidence locations, and reviewer overrides"
  - "Tender amendment and corrigenda/addenda handling with version history"
  - "Criteria provenance fields showing origin version, last modified version, and amendment badges"

**Coverage:** ✅ Fully addressed

---

### 5. Real tender and bid data will not be released for Round 1; sandbox with mock/redacted documents only

**Requirement:** Use representative mock or redacted documents; no actual government procurement data shared.

**Solution Design:**
- [SOLUTION.md §13: Round 2 Implementation Plan](./SOLUTION.md#13-round-2-implementation-plan)
  - "Assuming a sandbox with representative mock or redacted tenders and bids, we would implement in phases"
- [SOLUTION.md §15: Why This Proposal Is Strong for CRPF](./SOLUTION.md#15-why-this-proposal-is-strong-for-crpf)
  - "it is implementable incrementally in a sandbox with mock documents"

**Implementation:**
- [data/tender_sample.txt](./data/tender_sample.txt) — Mock tender with representative criteria (turnover, projects, GST, ISO)
- [data/bidders/](./data/bidders/) — Mock bidder JSON files (alpha_builders.json, bravo_infra.json, civic_structures.json) with representative structure
- [tests/evaluator.test.js](./tests/evaluator.test.js) — Test cases use mock data; no real procurement documents
- All prototype data is **mock and representative only**; no real tender or bid data included

**Coverage:** ✅ Fully addressed

---

## Success Criteria

### 1. Officer uploads tender; system extracts eligibility criteria for review

**Requirement:** Procurement officer uploads a tender document; system automatically extracts criteria and lists them for review.

**Solution Design:**
- [SOLUTION.md §5: Approach to Extracting Eligibility Criteria](./SOLUTION.md#5-approach-to-extracting-eligibility-criteria)
  - §5.2 Extraction Pipeline: canonicalization, section segmentation, criterion candidate detection (hybrid rules + LLM), classification, mandatory/optional detection, rule normalization, cross-document reconciliation
  - §5.2.8 Officer Review Step: "Before auto-evaluation, show extracted criteria to the officer for confirmation or correction"
- [SOLUTION.md §3.A: Tender Intake and Understanding](./SOLUTION.md#stage-a-tender-intake-and-understanding)
  - Steps 1-5: ingest, canonicalize, identify sections, extract candidate criteria, normalize, present to officer for review

**Implementation:**
- [app.js](./app.js) — `handleTenderUpload()` triggers `extractAndRenderCriteria()`
  - Sends tender text to backend via `fetch()` call to `/api/ai/extract-criteria`
  - Renders extracted criteria in UI with `renderCriteria()`, displays as approval cards
- [index.html](./index.html) — Extracted Criteria section shows normalized criterion cards with description, source clause, type, mandatory flag
  - Approval/rejection buttons for each criterion or bulk approve
- [core.js](./core.js) — `extractCriteria()` returns array of normalized criterion objects
- [SOLUTION.md §17: Current Website Implementation §5-8](./SOLUTION.md#17-current-website-implementation)
  - "Tender criterion extraction into structured rules"
  - "Officer approval and rejection workflow for extracted criteria"
  - "Officer notes and rejection reasons on the criteria review step"
  - "Evaluation gate that blocks bidder evaluation until criteria are approved"

**Coverage:** ✅ Fully addressed

---

### 2. For each bidder, criterion-by-criterion evaluation with source references

**Requirement:** System produces a structured evaluation showing each bidder against each criterion, with references back to source documents.

**Solution Design:**
- [SOLUTION.md §3.C: Criterion Matching and Decisioning](./SOLUTION.md#stage-c-criterion-matching-and-decisioning)
  - Steps 1-5: retrieve evidence, match clause semantics, run rule evaluation, assess confidence, emit verdict with explanation
- [SOLUTION.md §7: Matching Bidder Information Against Criteria](./SOLUTION.md#7-matching-bidder-information-against-criteria)
  - §7.1 Evidence Retrieval: exact field matches, semantic search, document-type priors, temporal filters, entity linking
  - §7.2 Rule Evaluation: deterministic logic with examples (financial threshold, document presence, similar project count)
- [SOLUTION.md §8: Explainable Verdict Generation](./SOLUTION.md#8-explainable-verdict-generation)
  - Each verdict record contains criterion ID, source clause, source document, extracted value, normalized value, decision logic, verdict, confidence, reason

**Implementation:**
- [app.js](./app.js) — `runEvaluation()` calls `evaluateBidder()` for each bidder against all approved criteria
  - Results displayed in `renderEvaluationResults()` with bidder cards, each containing criterion result cards
- [index.html](./index.html) — Bidder Evaluation section shows bidder cards with:
  - Bidder name and overall recommendation
  - Criterion result cards: criterion title, verdict (chip), reason text, detail grid with evidence location
- [core.js](./core.js) — `evaluateBidder()` iterates criteria, calls `evaluateCriterion()`, returns array of results
  - Each result: `{ criterion_id, verdict, reason, evidenceLocation, confidence, ... }`
- [SOLUTION.md §17: Current Website Implementation §9-11](./SOLUTION.md#17-current-website-implementation)
  - "Criterion-level bidder verdicts with `Eligible`, `Not Eligible`, and `Needs Manual Review` outcomes"
  - "Bidder evaluation result cards with decision logic, evidence, source document, and evidence location"
  - "Page-level or synthetic page evidence tracking for bidder documents"

**Coverage:** ✅ Fully addressed

---

### 3. Clearly eligible/ineligible marked; ambiguous cases flagged for manual review with reason

**Requirement:** System differentiates between clear verdicts and ambiguous cases; ambiguous cases show the reason for ambiguity.

**Solution Design:**
- [SOLUTION.md §2: Proposed Outcome §6](./SOLUTION.md#2-proposed-outcome)
  - "Return one of three criterion-level outcomes: `Eligible`, `Not Eligible`, `Needs Manual Review`"
- [SOLUTION.md §7.3: Handling Ambiguity](./SOLUTION.md#73-handling-ambiguity)
  - Lists ambiguity triggers and required reason text (low OCR confidence, contradictory evidence, partial similarity, etc.)
- [SOLUTION.md §8: Example Manual Review Verdict](./SOLUTION.md#example-manual-review-verdict)
  - Shows JSON with `Needs Manual Review` verdict and machine-generated reason

**Implementation:**
- [app.js](./app.js) — `renderEvaluationResults()` displays three verdict types:
  - Green "Eligible" chips for clear passes
  - Red "Not Eligible" chips for clear failures
  - Yellow "Needs Manual Review" chips for ambiguous cases with reason text highlighted
- [index.html](./index.html) — Manual Review Queue section displays all flagged cases with criterion, document, reason, recommended action
- [core.js](./core.js) — `evaluateCriterion()` returns verdict with `reason` field populated for all three outcomes
- [SOLUTION.md §17: Current Website Implementation §13](./SOLUTION.md#17-current-website-implementation)
  - "Live portfolio summary and manual review queue recalculation after overrides"

**Coverage:** ✅ Fully addressed

---

### 4. Consolidated report export with complete audit trail

**Requirement:** System can export a consolidated report signed off with a full audit trail of every automated decision.

**Solution Design:**
- [SOLUTION.md §8: Explainable Verdict Generation](./SOLUTION.md#8-explainable-verdict-generation)
  - Each verdict record includes all context needed for audit
- [SOLUTION.md §10: Auditability and Governance](./SOLUTION.md#10-auditability-and-governance)
  - Audit trail stores file hashes, timestamps, user identity, model versions, verdict records, reviewer overrides
- [SOLUTION.md §3.D: Human Review and Finalization](./SOLUTION.md#stage-d-human-review-and-finalization)
  - Step 3: "Freeze the final report with a full audit log"

**Implementation:**
- [app.js](./app.js) — `exportReport()` calls `buildEvaluationReport()` and triggers JSON download
- [core.js](./core.js) — `buildEvaluationReport()` constructs JSON with:
  - `tenderVersions[]`: all tender uploads and amendments with version history
  - `amendmentHistory[]`: criteria changes across versions
  - `criteriaReview`: extracted and approved criteria
  - `bidderEvaluations[]`: criterion-by-criterion results for each bidder
  - `reviewerOverrides[]`: all manual intervention records
  - `auditTrail[]`: all timestamped events
- [index.html](./index.html) — Export Report button triggers download; audit trail panel shows complete event log
- [SOLUTION.md §17: Current Website Implementation §17-18](./SOLUTION.md#17-current-website-implementation)
  - "Audit trail logging for uploads, review actions, evaluations, and overrides"
  - "JSON report export including criteria review, amendment history, evidence locations, and reviewer overrides"

**Coverage:** ✅ Fully addressed

---

## Summary

| Requirement | Coverage | Evidence |
|-------------|----------|----------|
| Explainable at criterion level | ✅ Full | §8 Verdicts, implementation result cards with all required fields |
| Never silently disqualify | ✅ Full | §7.3 Ambiguity handling, §9 HITL design, manual review queue UI |
| Handle scanned/photo documents | ✅ Full | §6.1 OCR engine justification, §6.2 preprocessing pipeline, Azure Document Intelligence |
| Auditable end-to-end | ✅ Full | §10 Audit design, immutable snapshots planned, JSON report export |
| Mock data only (no real tender data) | ✅ Full | All sample data in `data/` is mock and representative |
| Officer uploads tender → extract criteria | ✅ Full | handleTenderUpload() + extractAndRenderCriteria(), approval gate |
| Criterion-by-criterion evaluation | ✅ Full | evaluateBidder() + result cards with evidence location |
| Clear/ambiguous differentiation | ✅ Full | Three verdict types, manual review queue with reasons |
| Consolidated report + audit trail | ✅ Full | buildEvaluationReport() exports JSON with full audit log |

**Conclusion:** The proposed solution design and current working prototype fully address all non-negotiables and success criteria for Round 1 evaluation.
