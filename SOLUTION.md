# AI-Based Tender Evaluation and Eligibility Analysis for Government Procurement by CRPF

## 1. Problem Understanding

Government tender evaluation is not just a document-reading task. It is a high-stakes compliance workflow where a committee must determine, and later defend, why a bidder was accepted, rejected, or referred for clarification. In practice, the difficulty comes from five realities:

1. Tender criteria are distributed across multiple sections such as eligibility conditions, technical specifications, qualification criteria, annexures, corrigenda, and compliance checklists.
2. The same requirement may be expressed in legal, technical, or tabular form, with cross-references like "as per clause 4.2" or "must submit proof thereof".
3. Bidder submissions are heterogeneous: machine-readable PDFs, scanned documents, low-quality photocopies, images from mobile cameras, spreadsheets, and Word files.
4. Procurement decisions must be defensible. A black-box AI score is unusable unless every conclusion is linked to the exact clause and exact supporting evidence.
5. Ambiguity is common. Missing pages, poor OCR, expired certificates, unclear project descriptions, and inconsistent financial figures cannot be silently treated as failure.

Our solution is therefore not a single model. It is a governed AI decision-support platform that combines document ingestion, OCR and layout understanding, criterion extraction, evidence retrieval, deterministic rule evaluation, confidence gating, and a human review console with a full audit trail.

The design principle is simple:

**Use AI to read and structure documents, but use transparent rules and evidence-backed reasoning to make or recommend eligibility decisions.**

## 2. Proposed Outcome

Given one tender and multiple bidder submissions, the platform will:

1. Extract and normalize all eligibility criteria from the tender.
2. Classify each criterion as financial, technical, compliance, documentary, or certification-related.
3. Mark each criterion as mandatory, optional, or clarification-dependent.
4. Parse each bidder submission across mixed file types and extract relevant evidence.
5. Evaluate bidder evidence against each criterion using deterministic rule checks.
6. Return one of three criterion-level outcomes:
   - `Eligible`
   - `Not Eligible`
   - `Needs Manual Review`
7. Produce an overall bidder recommendation only after criterion-level evaluation.
8. Generate a consolidated, exportable report with clause references, evidence references, extracted values, confidence indicators, and reviewer actions.

This reduces manual effort while preserving government-grade explainability and auditability.

## 3. End-to-End Workflow

### Stage A: Tender Intake and Understanding

1. Ingest tender package including main tender, annexures, corrigenda, and addenda.
2. Convert each file into a canonical document format preserving:
   - page numbers
   - section headings
   - tables
   - clause hierarchy
   - source file identity
3. Run document understanding to identify sections such as:
   - eligibility criteria
   - technical qualification
   - financial qualification
   - statutory compliance
   - mandatory forms and declarations
4. Extract candidate criteria and normalize them into structured rules.
5. Present extracted criteria to the procurement officer for review and approval before bidder evaluation begins.

### Stage B: Bidder Intake and Evidence Extraction

1. Ingest each bidder's submitted files.
2. Detect document type:
   - machine-readable PDF
   - scanned PDF
   - image/photo
   - Word document
   - spreadsheet/table
3. Apply the right extraction pipeline for each document.
4. Extract structured entities and evidence snippets relevant to tender criteria.
5. Group evidence into bidder profiles such as:
   - company identity
   - statutory registrations
   - financial metrics
   - project experience
   - certifications
   - document completeness

### Stage C: Criterion Matching and Decisioning

1. For each criterion, retrieve all bidder evidence candidates.
2. Match clause semantics to evidence semantics.
3. Run a rule evaluation engine.
4. Assess confidence, contradiction, incompleteness, and document validity.
5. Emit criterion-level verdict plus explanation.

### Stage D: Human Review and Finalization

1. Route low-confidence or ambiguous cases to manual review.
2. Allow the officer to inspect:
   - tender clause
   - extracted value
   - source document page
   - OCR confidence
   - reason for ambiguity
3. Capture reviewer decisions and comments.
4. Freeze the final report with a full audit log.

## 4. Core Architecture

### 4.1 System Components

The platform has seven major layers:

1. **Document Ingestion Layer**
   - File upload, virus scan, file hashing, metadata capture, format detection.

2. **Document Understanding Layer**
   - OCR, layout parsing, section segmentation, table extraction, image enhancement.

3. **Tender Intelligence Layer**
   - Clause extraction, criterion classification, mandatory/optional detection, rule normalization.

4. **Bidder Intelligence Layer**
   - Entity extraction, financial value extraction, certificate parsing, project-experience extraction, document validation.

5. **Eligibility Decision Engine**
   - Rule execution, evidence ranking, contradiction handling, confidence-based triage.

6. **Explainability and Audit Layer**
   - Evidence lineage, reasoning summaries, event logs, model version tracking.

7. **Review and Reporting Layer**
   - Human review dashboard, criterion drill-down, exportable evaluation report, sign-off workflow.

### 4.2 Technical Stack

The website uses:

- **Frontend**: Vanilla HTML, CSS, and JavaScript in the browser
- **Backend**: Node.js HTTP server
- **Document extraction**: Azure Document Intelligence for PDFs/images/Office files, `mammoth` for DOCX, and `word-extractor` for legacy DOC
- **LLM / reasoning layer**: Amazon Bedrock with `nova-lite`
- **Report format**: Structured JSON export, with non-JSON formats deferred
- **State model**: In-browser application state with audit trail, review metadata, and amendment provenance

The prototype still separates AI extraction from deterministic decisioning. This improves trust, reduces hallucination risk, and makes outputs easier to audit.

## 5. Approach to Extracting Eligibility Criteria from Tender Documents

### 5.1 Why Tender Understanding Is Hard

Tender documents rarely state all criteria in one neat list. A financial threshold may appear in the qualification section, while supporting document requirements are hidden in annexures and statutory declarations in standard forms. Corrigenda may later modify thresholds or extend date windows. The platform therefore needs document-wide understanding, not keyword search.

### 5.2 Extraction Pipeline

We propose a multi-step tender parsing pipeline:

1. **Canonicalization**
   - Convert every tender file into page-level text blocks with preserved coordinates, tables, headers, and footers.

2. **Section Segmentation**
   - Identify headings, subheadings, clause numbers, and annexures.
   - Build a clause tree such as `4 -> 4.1 -> 4.1.2`.

3. **Criterion Candidate Detection**
   - Use a hybrid approach:
     - rules and regex for common patterns (`minimum turnover`, `must have`, `valid registration`, `last 5 years`)
     - LLM-based clause tagging for more complex legal phrasing

4. **Criterion Classification**
   - Assign each criterion to one or more categories:
     - financial
     - technical
     - compliance
     - documentary
     - certification
     - temporal validity

5. **Mandatory vs Optional Detection**
   - Use lexical signals:
     - mandatory: `shall`, `must`, `mandatory`, `required`, `essential`, `bid will be rejected if`
     - optional or preferred: `may`, `desirable`, `preferable`
   - Use context and section type because some optional-looking phrases become mandatory in qualifying sections.

6. **Rule Normalization**
   - Transform free text into structured objects.

Example normalized criterion:

```json
{
  "criterion_id": "FIN-001",
  "type": "financial_turnover",
  "description": "Average annual turnover must be at least INR 5 crore",
  "mandatory": true,
  "operator": ">=",
  "threshold_value": 50000000,
  "threshold_currency": "INR",
  "measurement_window": "last_3_financial_years",
  "required_documents": ["audited_balance_sheet", "ca_certificate"],
  "source_clause": "Clause 4.2.1",
  "source_pages": [12],
  "exceptions": []
}
```

7. **Cross-Document Reconciliation**
   - If corrigenda modify a clause, mark the latest rule as effective and preserve version history.

8. **Officer Review Step**
   - Before auto-evaluation, show extracted criteria to the officer for confirmation or correction.
   - This human checkpoint is critical in government workflows.

### 5.3 Types of Criteria the System Must Support

The rule model must support at least:

- numeric thresholds
- count-based requirements
- date validity requirements
- presence or absence of documents
- named certification requirements
- similarity conditions for prior work
- yes/no declarations
- conditional requirements such as "for OEMs only" or "if turnover is claimed through parent company"

## 6. Approach to Parsing Bidder Submissions

### 6.1 OCR and Document Intelligence Engine Selection

**Why Azure Document Intelligence?**

The platform uses Azure Document Intelligence (Form Recognizer API) as the primary OCR and layout-understanding engine for the following reasons:

1. **Superior layout preservation** — Unlike Tesseract (which excels at pure OCR but loses structural context), Azure understands tables, headers, multi-column layouts, and form fields. This is critical for processing diverse bidder submissions where structure encodes meaning (e.g., financial tables, certificate templates).

2. **Pre-built industry models** — Azure includes pre-trained models for specific document types (invoices, receipts, business cards). While government tender submissions are custom, the layout model generalizes well across scanned documents and photographs.

3. **Confidence scoring at word level** — Essential for audit trails. When OCR confidence on a key field is below 70%, the system routes the case to manual review rather than silently accepting a misread value.

4. **Handles degraded images** — Scanned documents from procurement offices are often low-quality (poor lighting, skew, ink bleed). Azure's preprocessing (deskew, denoise, contrast enhancement) outperforms Tesseract, which requires manual preprocessing tuning.

5. **Comparison to alternatives:**
   - **Tesseract**: Open source, lower cost, but lacks layout understanding and requires heavy preprocessing. Not suitable for government audit trails that demand reproducibility.
   - **Google Vision API**: Comparable quality to Azure, but higher per-request costs and less transparent confidence scoring; also requires careful handling of PII (documents may contain SSNs, PAN, etc.).

**Hybrid approach for word-format documents:**

For `.doc` and `.docx` files, the system uses specialized libraries:
- `mammoth` (DOCX) and `word-extractor` (legacy DOC) for direct text extraction before resorting to OCR. This avoids OCR overhead when machine-readable text is available and preserves native formatting metadata.

### 6.2 Heterogeneous Document Handling

Bidder submissions are messy because the same fact can be shown through balance sheets, CA certificates, work orders, completion certificates, GST certificates, affidavits, or covering letters. The platform must treat documents as evidence sources, not just files.

We use a modality-aware pipeline:

#### A. Machine-readable PDFs and Word Files

- direct text extraction
- table detection
- section parsing
- metadata extraction

#### B. Scanned PDFs

- image preprocessing
  - de-skew
  - denoise
  - contrast enhancement
  - page orientation correction
- OCR with word/line confidence
- layout preservation

#### C. Photographs of Certificates

- perspective correction
- crop detection
- text region enhancement
- OCR
- seal/stamp/signature presence detection where relevant

#### D. Tables and Financial Statements

- table structure extraction
- row and column alignment
- account label normalization
- value extraction with unit normalization (`lakh`, `crore`, commas, decimals)

### 6.3 Bidder Evidence Schema

All extracted evidence is stored in a structured evidence model:

```json
{
  "evidence_id": "EVID-2041",
  "bidder_id": "BID-07",
  "document_id": "DOC-19",
  "document_type": "gst_certificate",
  "field_name": "gst_registration_number",
  "field_value": "29ABCDE1234F1Z5",
  "normalized_value": "29ABCDE1234F1Z5",
  "page": 2,
  "bounding_box": [110, 220, 480, 290],
  "extraction_method": "ocr_plus_template_extractor",
  "confidence": 0.97,
  "issued_date": "2024-05-01",
  "expiry_date": null
}
```

This representation enables page-level traceability and visual highlighting in the UI.

### 6.4 Information Extraction Targets

The system will extract:

- company name and legal identity
- PAN, GST, CIN, MSME or other statutory identifiers
- turnover and net worth values
- date ranges of financial statements
- past project names, values, completion dates, client names, scope summaries
- certification names and validity dates
- declaration presence
- supporting document presence and completeness

### 6.5 Handling Variation in Presentation

A bidder may state "turnover" in one document as:

- annual turnover
- total revenue
- revenue from operations
- gross receipts
- certified turnover by CA

Similarly, "similar project" may be described using domain-specific phrasing. We handle this with:

1. domain vocabularies and synonym maps
2. semantic retrieval over extracted passages
3. LLM-assisted normalization into canonical field types
4. confidence scoring and contradiction checks across documents

## 7. Matching Bidder Information Against Criteria

### 7.1 Evidence Retrieval

For each criterion, the system retrieves candidate evidence from all bidder documents using:

- exact field matches where available
- semantic search over passages
- document-type priors
- temporal filters
- entity linking

Example:

- Criterion: "At least 3 similar projects completed in the last 5 years"
- Candidate evidence sources:
  - project experience table
  - work orders
  - completion certificates
  - client letters

### 7.2 Rule Evaluation

Each normalized criterion is evaluated through deterministic logic.

Examples:

#### Financial Threshold

```text
If extracted turnover >= threshold
and the evidence document is valid
and the financial period matches the tender requirement
then Eligible
else if turnover < threshold with high confidence
then Not Eligible
else Needs Manual Review
```

#### Document Presence

```text
If mandatory GST certificate found and registration number extracted with high confidence
then Eligible
else if no relevant document found
then Needs Manual Review or Not Eligible depending on tender language and review policy
```

#### Similar Project Count

This is more complex because "similar" is a semantic concept. We would:

1. extract all claimed projects
2. compute similarity against tender scope using:
   - keyword overlap
   - domain taxonomy
   - embedding similarity
   - LLM-based justification
3. require documentary support such as completion certificate or work order
4. only count projects above a similarity threshold and with sufficient evidence
5. send borderline cases to manual review

### 7.3 Handling Ambiguity

The system must not equate uncertainty with ineligibility. Ambiguity arises when:

- OCR confidence is low
- multiple contradictory values are found
- project scope is only partially similar
- a certificate is present but expiry date is unreadable
- a document is missing pages
- a clause itself is ambiguous or conditional

In these situations the system returns:

`Needs Manual Review`

with a machine-generated reason such as:

- "Turnover value extracted from scanned CA certificate has OCR confidence 0.58"
- "Two different turnover figures found in balance sheet and declaration letter"
- "Project description indicates civil works but similarity to tendered construction scope is borderline"

This is essential to avoid unsafe automation.

## 8. Explainable Verdict Generation

Explainability must exist at the criterion level, not just the bidder level.

Each verdict record contains:

- criterion ID and plain-language criterion text
- tender source clause and page
- bidder document used
- extracted value
- normalized value
- decision logic applied
- verdict
- confidence
- reason code
- link to source evidence

### Example Verdict

```json
{
  "bidder_id": "BID-03",
  "criterion_id": "FIN-001",
  "criterion_text": "Average annual turnover must be at least INR 5 crore",
  "tender_clause": "Clause 4.2.1",
  "source_evidence": [
    {
      "document": "CA_Certificate.pdf",
      "page": 1,
      "value_found": "INR 5.73 crore",
      "confidence": 0.93
    }
  ],
  "evaluation_logic": "5.73 crore >= 5.00 crore",
  "verdict": "Eligible",
  "reason": "Threshold met based on CA-certified turnover statement",
  "manual_review_required": false
}
```

### Example Manual Review Verdict

```json
{
  "bidder_id": "BID-09",
  "criterion_id": "FIN-001",
  "verdict": "Needs Manual Review",
  "reason": "Scanned turnover certificate has low OCR confidence and one digit is ambiguous",
  "source_evidence": [
    {
      "document": "TurnoverScan.jpg",
      "page": 1,
      "value_found": "INR ?.8 crore",
      "confidence": 0.54
    }
  ]
}
```

## 9. Human-in-the-Loop Design

The platform is a decision-support system, not an autonomous disqualification engine.

### 9.1 Review Triggers

A case is sent to manual review when:

- extraction confidence falls below a policy threshold
- contradictory evidence exists
- tender clause interpretation confidence is low
- supporting evidence is incomplete
- semantic similarity is borderline
- certificate validity cannot be established
- a corrigendum affects the interpreted criterion

### 9.2 Reviewer Experience

For each flagged case, the reviewer sees:

- tender clause text with page number
- extracted criterion summary
- bidder evidence snippets
- highlighted source image or PDF region
- confidence scores
- why the system could not decide safely
- recommended next action

### 9.3 Reviewer Actions

The officer may:

- accept system suggestion
- override verdict with justification
- request additional documents
- mark a document as unreadable or irrelevant
- correct an extracted field

All reviewer actions become part of the audit log.

## 10. Auditability and Governance

Government procurement requires more than logs. It requires a reproducible chain of decision evidence.

### 10.1 Audit Trail Design

For every run, we store:

- uploaded file hash
- upload timestamp
- user identity
- OCR engine version
- extraction model version
- prompt or extraction template version
- normalized criterion version
- evidence objects created
- rule evaluation trace
- final verdict
- reviewer overrides and comments

### 10.2 Why This Matters

If a bidder challenges a decision, the authority must be able to show:

1. which tender clause was applied
2. which bidder document was examined
3. what value the system extracted
4. whether the case was low confidence
5. whether a human officer reviewed or overrode the output

This auditability makes the platform suitable for formal procurement environments and internal review.

### 10.3 Guardrails

We would enforce:

- no auto-rejection on low-confidence evidence
- immutable run snapshots after sign-off
- role-based access control
- encryption at rest and in transit
- redaction support for personally identifiable information if needed
- strict separation between raw documents and generated summaries

## 11. Key Technology and Model Choices

### 11.1 Why Hybrid AI + Rules

Pure rules are brittle because tender language varies widely.

Pure LLM decisioning is risky because:

- it may hallucinate missing evidence
- it is difficult to audit
- output consistency may vary

So the correct design is:

- AI for reading and structuring unstructured content
- deterministic rules for final eligibility checks
- confidence thresholds and human review for ambiguity

### 11.2 LLM Selection: Amazon Bedrock with nova-lite

**Why Amazon Bedrock?**

1. **Vendor independence** — Bedrock abstracts away specific model vendor (Anthropic, Meta, Mistral, etc.), allowing easy model swaps without re-engineering. This is critical for government procurement, where vendor lock-in risks must be minimized.

2. **Model isolation and safety** — Bedrock runs models in isolated environments with strict request/response isolation. Sensitive procurement documents (potentially containing PII or strategic information) are not used to train or fine-tune shared models.

3. **Audit-ready logging** — Full request/response logging, model version tracking, and invocation counts support government compliance and cost transparency.

4. **Cost-effective inference** — Pay per token consumed; no minimum commitments. Suitable for variable-load tender evaluation workflows.

**Why nova-lite (vs. other models)?**

1. **Speed and cost balance** — nova-lite is optimized for instruction-following tasks (criterion extraction, entity classification) with lower latency and cost than larger models (claude-opus, GPT-4).

2. **Sufficient reasoning for tender extraction** — Tender criteria extraction is a structured task (identify clauses, classify financial/technical/compliance). nova-lite is sufficient for this; larger models would be wasteful.

3. **Local fine-tuning ready** — nova-lite is available for local fine-tuning, enabling organizations to adapt it to domain-specific tender language without re-architecting the pipeline.

4. **Comparison to alternatives:**
   - **GPT-4**: Overkill for extraction tasks; requires OpenAI dependency; higher per-token cost.
   - **Open-source models (Llama 2, Mistral)**: Require on-premise hosting and fine-tuning; higher operational overhead for government IT departments.
   - **Smaller specialized models**: Often underperform on complex legal/financial language extraction.

### 11.3 Model Strategy for Different Tasks

We use different model classes for different tasks:

1. **OCR/Layout Models** (Azure Document Intelligence)
   - to read scans, tables, and page structure
   - confidence scoring essential for audit

2. **Clause Extraction / Information Extraction LLM** (Bedrock nova-lite)
   - to convert tender text into normalized criteria
   - to extract structured fields from bidder documents

3. **Semantic Matching Model** (Embedding-based or lightweight LLM)
   - to compare project descriptions and technical similarity
   - to rank evidence by relevance

4. **Rule Engine** (Custom deterministic logic)
   - to compute transparent pass/fail/review outputs
   - to aggregate multi-criterion evidence

This modularity allows later replacement of any model without redesigning the whole system. For example, an organization could swap nova-lite for a fine-tuned local model without touching OCR or rule logic.

## 11.4 Edge Cases and Mitigation Strategy

The platform must handle common failure modes that arise in real procurement:

### A. Scanned Documents with Poor Image Quality

**Problem:** Low-contrast, skewed, or low-resolution scans common in government procurement offices.

**Examples:**
- Photocopy of photocopy (cascading artifacts)
- Mobile phone photo taken at angle
- Faxed documents (compression artifacts)

**Mitigation:**
- Preprocessing pipeline: deskew, denoise (bilateral filter), contrast enhancement (CLAHE)
- Multi-pass OCR: fallback to higher-sensitivity settings if first pass yields low confidence
- Confidence threshold: if word-level confidence < 70%, flag for manual review
- Bounding box capture: enable reviewer to see exactly what OCR extracted vs. original

### B. Ambiguous Numeric Values

**Problem:** Turnover can be stated as "5 crores", "5 Cr", "50,000,000", "5,00,00,000" (Indian notation), or even "~5 Cr" (approximate).

**Examples:**
- Currency notation inconsistency across documents
- Use of abbreviations (Cr, Lac, K)
- Conflicting figures in balance sheet vs. CA certificate

**Mitigation:**
- Unit normalization: map all abbreviations to canonical form (e.g., all to INR)
- Contradiction detection: if two documents show different turnover figures, flag for manual review
- Confidence scoring: penalize extracted values that required multiple transformations
- Audit trace: record original extracted value, normalized value, and transformation applied

### C. Expired or Invalid Certificates

**Problem:** Certificate validity dates can be ambiguous (issue date, expiry date may be missing or in non-standard formats).

**Examples:**
- ISO certification with expiry date close to tender deadline
- GST certificate showing "valid until revoked" (no explicit expiry)
- Certificate in a scanned image with unreadable expiry date

**Mitigation:**
- Date extraction confidence: if expiry date OCR confidence < 80%, route to manual review
- Temporal validation: check if certificate was valid on tender submission date
- Missing expiry logic: require explicit human confirmation for open-ended certificates
- Audit log: record whether system auto-accepted or referred to reviewer

### D. Partial Information and Missing Pages

**Problem:** Bidders sometimes omit required documents or submit incomplete evidence.

**Examples:**
- Balance sheet without notes (required for CA certificate linkage)
- Project experience without work order or completion certificate
- Financial statement missing one page

**Mitigation:**
- Document completeness check: flag if expected document sections are missing
- Partial evidence logic: require higher confidence on all extracted fields if supporting docs are absent
- Manual review trigger: incomplete evidence → automatic escalation
- Evidence ranking: prioritize high-authority documents (audited statements > self-declarations)

### E. Format Inconsistency Within a Single Bid

**Problem:** The same bidder may submit project details in a table in one document, narrative in another, and work orders in a third.

**Examples:**
- Project scope in tender response vs. project scope in completion certificate
- Financial figures in annual return vs. GST return vs. bank statement

**Mitigation:**
- Entity linking: map references to same entity across documents
- Cross-document validation: compute similarity between claims in different documents
- Contradiction handling: multiple conflicting sources → manual review (not silent failure)
- Confidence aggregation: combine confidence from multiple sources (higher if consistent)

### F. Ambiguous Legal Language

**Problem:** Procurement tender language often contains conditional or subjective clauses.

**Examples:**
- "Bidder must have experience in similar projects" (what is "similar"?)
- "Turnover must demonstrate financial capacity" (unspecified threshold)
- "Subject to approvals as per government policy" (policy not always explicit)

**Mitigation:**
- Officer review checkpoint: ambiguous criteria highlighted during criterion extraction phase
- Semantic threshold configuration: "similar project" similarity > 0.7 (tunable)
- Explicit flagging: ambiguity reason codes in audit log
- LLM confidence: low LLM confidence on criterion extraction → human confirmation required

### G. Temporal Mismatches

**Problem:** Financial thresholds often require data from a specific period (e.g., "last 3 financial years"), but bidder submissions may contain data from different periods.

**Examples:**
- Tender requires "last 3 years" but bidder submits 2 years of financials
- Turnover requirement based on FY 2024-25, but bidder submits data through March 2024

**Mitigation:**
- Temporal validation: extract and validate financial year ranges from all documents
- Period mismatch detection: if bidder data spans different period, flag explicitly
- Policy compliance: officer configures acceptable tolerance (e.g., ±6 months)
- Audit record: which years were used to compute each metric

## 12. Risks and Trade-Offs

### Risk 1: Poor OCR on low-quality scans

**Impact:** wrong value extraction or unreadable fields.

**Mitigation:**

- preprocessing pipeline
- multiple OCR strategies
- confidence gating
- mandatory human review below threshold

### Risk 2: Ambiguous tender language

**Impact:** incorrect criterion extraction.

**Mitigation:**

- clause-level human confirmation before evaluation
- versioned tender rule set
- explicit reason codes when interpretation is uncertain

### Risk 3: "Similar project" is subjective

**Impact:** false positives or false negatives.

**Mitigation:**

- hybrid semantic scoring plus documentary validation
- configurable similarity thresholds
- default to manual review for borderline cases

### Risk 4: Contradictory documents within one bid

**Impact:** unstable decisions.

**Mitigation:**

- contradiction detection
- evidence ranking by document authority
- manual review rather than silent resolution

### Risk 5: Trust deficit from procurement officers

**Impact:** system adoption failure even if technically strong.

**Mitigation:**

- evidence-backed UI
- no black-box final scoring
- easy clause-to-document traceability
- exportable reports aligned with existing workflows

### Trade-Off: Accuracy vs Throughput

Aggressive automation increases speed but risks wrongful rejection. In procurement, that trade-off must favor defensibility over full automation. Our design explicitly chooses safe triage and explainability over maximum auto-disqualification.

## 13. Round 2 Implementation Plan

Assuming a sandbox with representative mock or redacted tenders and bids, we would implement in phases.

### Phase 1: Foundations

- set up ingestion pipeline
- support PDF, scanned PDF, DOCX, JPG, PNG
- build canonical document schema
- store page images, text, layout, metadata

### Phase 2: Tender Criterion Extraction

- implement clause segmentation
- build criterion taxonomy
- implement LLM-assisted extraction to structured JSON
- add officer review screen for criterion approval

### Phase 3: Bidder Evidence Extraction

- build extractors for:
  - turnover
  - GST registration
  - certification presence and validity
  - project experience
- add OCR confidence capture and image-region references

### Phase 4: Rule Engine and Verdict Layer

- implement normalized criterion schema
- implement pass/fail/manual-review logic
- implement contradiction and confidence handling
- generate criterion-level explanations

### Phase 5: Review Console and Reporting

- reviewer dashboard
- manual decision capture
- consolidated bidder comparison view
- exportable PDF/Excel report with audit references

### Phase 6: Evaluation and Hardening

- benchmark extraction accuracy on mock data
- measure false auto-fail rate
- tune thresholds to reduce unsafe automation
- add security, logging, role-based access control

## 14. Example Output for the Sample Scenario

For the sample construction-services tender, the system would:

1. Extract these criteria:
   - turnover >= INR 5 crore
   - minimum 3 similar projects in last 5 years
   - valid GST registration
   - valid ISO 9001 certification

2. Evaluate each of the 10 bidders against each criterion.

3. Produce outputs such as:
   - 6 bidders: `Eligible`, with exact evidence for all 4 criteria
   - 3 bidders: `Not Eligible`, with failed criterion and supporting document reference
   - 1 bidder: `Needs Manual Review`, because the turnover certificate is a low-quality scan with uncertain digits

4. Export a consolidated report showing:
   - bidder-wise summary
   - criterion-wise matrix
   - explanation for each verdict
   - manual review cases
   - audit references for every automated decision

## 15. Why This Proposal Is Strong for CRPF

This solution is suited to CRPF procurement because it reflects operational reality:

- it handles scanned and photographic evidence, not only text PDFs
- it avoids unsafe black-box disqualification
- it supports a committee's need to justify decisions
- it provides criterion-level traceability
- it preserves human control for ambiguous cases
- it is implementable incrementally in a sandbox with mock documents

Most importantly, it treats AI as an accelerator for disciplined public procurement, not as a replacement for accountable decision-making.

## 16. Conclusion

We propose a hybrid AI platform for tender eligibility analysis that reads complex tender documents, extracts formal criteria, parses heterogeneous bidder submissions, evaluates each bidder against each criterion using evidence-backed rules, and produces auditable explanations for every verdict.

The core innovation is not merely document extraction. It is the combination of:

- multi-format document intelligence
- normalized criterion modeling
- evidence-linked rule evaluation
- safe ambiguity handling
- human-in-the-loop review
- procurement-grade auditability

Such a system can significantly reduce evaluation time, improve consistency across evaluators, and strengthen the defensibility of procurement decisions for organisations such as CRPF.

## 17. Current Website Implementation

The browser app currently implements the following end-to-end features:

1. Tender upload for `.txt`, `.pdf`, `.doc`, `.docx`, and image scans.
2. Bidder upload for `.json`, `.pdf`, `.doc`, `.docx`, and image scans.
3. DOCX extraction through `mammoth` and legacy DOC extraction through `word-extractor`.
4. Azure Document Intelligence fallback for supported scanned and office formats.
5. Tender criterion extraction into structured rules.
6. Officer approval and rejection workflow for extracted criteria.
7. Officer notes and rejection reasons on the criteria review step.
8. Evaluation gate that blocks bidder evaluation until criteria are approved.
9. Criterion-level bidder verdicts with `Eligible`, `Not Eligible`, and `Needs Manual Review` outcomes.
10. Bidder evaluation result cards with decision logic, evidence, source document, and evidence location.
11. Page-level or synthetic page evidence tracking for bidder documents.
12. Reviewer overrides for individual criterion results, with optional justification notes.
13. Live portfolio summary and manual review queue recalculation after overrides.
14. Tender amendment and corrigenda/addenda handling with version history.
15. Amendment change detection for added, modified, and removed criteria.
16. Criteria provenance fields showing origin version, last modified version, and amendment badges.
17. Audit trail logging for uploads, review actions, evaluations, and overrides.
18. JSON report export including criteria review, amendment history, evidence locations, and reviewer overrides.
19. Reset and re-extraction workflow for restarting the review process.

### What Is Still Deferred

1. Persistent database storage.
2. Authentication and role-based access control.
3. Interactive source-document highlighting or embedded viewer links.
4. Bounding-box level visual highlighting in the UI.
5. Production observability and deployment hardening.
