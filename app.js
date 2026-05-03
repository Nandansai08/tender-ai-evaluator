const state = {
  tenderText: "",
  tenderSource: null,
  criteria: [],
  bidders: [],
  audit: [],
  results: [],
};

const { buildEvaluationReport, extractCriteria, evaluateBidder, summarizeEvaluation } = window.TenderEvaluatorCore;
const API_BASE_URL = "http://localhost:3000";

const samplePaths = {
  tender: "./data/tender_sample.txt",
  bidders: [
    "./data/bidders/alpha_builders.json",
    "./data/bidders/bravo_infra.json",
    "./data/bidders/civic_structures.json",
  ],
};

const MAX_DOCUMENT_UPLOAD_BYTES = 50 * 1024 * 1024;

const fallbackScenario = {
  tenderText: `CRPF Representative Tender - Construction Services

Clause 4.2 Financial Eligibility
The bidder must demonstrate a minimum annual turnover of INR 5 crore based on certified financial statements.

Clause 4.3 Technical Eligibility
The bidder must have completed at least 3 similar projects completed in the last 5 years.

Clause 5.1 Compliance Requirements
The bidder shall submit a valid GST registration certificate.

Clause 5.2 Quality Certification
The bidder shall submit a valid ISO 9001 certification.`,
  bidders: [
    {
      bidderName: "Alpha Builders Pvt Ltd",
      documents: {
        turnover: {
          valueCrore: 6.4,
          confidence: 0.95,
          conflicting: false,
          document: "CA_Certificate_Alpha.pdf",
        },
        projects: [
          { name: "District Barracks Upgrade", similarity: "high", completed: true },
          { name: "Training Campus Expansion", similarity: "high", completed: true },
          { name: "Police Housing Block", similarity: "high", completed: true },
        ],
        gst: {
          present: true,
          valid: true,
          number: "29ABCDE1234F1Z5",
          document: "GST_Alpha.pdf",
        },
        iso: {
          present: true,
          valid: true,
          confidence: 0.94,
          certificateId: "ISO-ALPHA-9001",
          document: "ISO_Alpha.jpg",
        },
      },
    },
    {
      bidderName: "Bravo Infra Works",
      documents: {
        turnover: {
          valueCrore: 4.1,
          confidence: 0.92,
          conflicting: false,
          document: "Audited_Financials_Bravo.pdf",
        },
        projects: [
          { name: "Municipal Road Repair", similarity: "medium", completed: true },
          { name: "Boundary Wall Package", similarity: "high", completed: true },
          { name: "Drainage Rehabilitation", similarity: "low", completed: true },
        ],
        gst: {
          present: true,
          valid: true,
          number: "07PQRSX9876L1Z2",
          document: "GST_Bravo.pdf",
        },
        iso: {
          present: false,
          valid: false,
          confidence: 0,
          certificateId: "",
          document: "",
        },
      },
    },
    {
      bidderName: "Civic Structures Consortium",
      documents: {
        turnover: {
          valueCrore: 5.8,
          confidence: 0.58,
          conflicting: true,
          document: "Scanned_Turnover_Certificate_Civic.jpg",
        },
        projects: [
          { name: "Security Compound Construction", similarity: "high", completed: true },
          { name: "Transit Camp Buildout", similarity: "medium", completed: true },
          { name: "Storage Depot Shed", similarity: "high", completed: true },
        ],
        gst: {
          present: true,
          valid: false,
          number: "GST number partially visible",
          document: "GST_Civic_scan.jpg",
        },
        iso: {
          present: true,
          valid: true,
          confidence: 0.62,
          certificateId: "ISO-CIVIC-9001",
          document: "ISO_Civic_scan.jpg",
        },
      },
    },
  ],
};

document.getElementById("load-sample-btn").addEventListener("click", loadSampleScenario);
document.getElementById("run-eval-btn").addEventListener("click", () => runEvaluation());
document.getElementById("reset-btn").addEventListener("click", resetApp);
document.getElementById("export-report-btn").addEventListener("click", exportReport);
document.getElementById("tender-file").addEventListener("change", handleTenderUpload);
document.getElementById("bidder-files").addEventListener("change", handleBidderUploads);

function pushAudit(event, detail) {
  state.audit.push({
    timestamp: new Date().toLocaleTimeString(),
    event,
    detail,
  });
  renderAudit();
}

async function loadSampleScenario() {
  try {
    resetApp(false);

    const [tenderResponse, ...bidderResponses] = await Promise.all([
      fetch(samplePaths.tender),
      ...samplePaths.bidders.map((path) => fetch(path)),
    ]);

    const failedResponse = [tenderResponse, ...bidderResponses].find((response) => !response.ok);
    if (failedResponse) {
      throw new Error(`Could not load ${failedResponse.url || "sample data"}`);
    }

    state.tenderText = await tenderResponse.text();
    state.tenderSource = "tender_sample.txt";
    const bidders = await Promise.all(bidderResponses.map((response) => response.json()));
    state.bidders = await Promise.all(
      bidders.map((bidder, index) => normalizeBidderEvidence(bidder, samplePaths.bidders[index])),
    );

    updateStatus();
    pushAudit("Mock CRPF scenario loaded", "Loaded tender_sample.txt and 3 bidder evidence files.");
    await extractAndRenderCriteria("Mock CRPF scenario tender");
    renderCriteria();
    runEvaluation("Mock CRPF scenario evaluated");
  } catch (error) {
    state.tenderText = fallbackScenario.tenderText;
    state.tenderSource = "embedded_mock_crpf_scenario";
    state.bidders = await Promise.all(
      fallbackScenario.bidders.map((bidder) => normalizeBidderEvidence(bidder, bidder.bidderName)),
    );

    updateStatus();
    pushAudit("Mock CRPF scenario loaded", `Used embedded scenario because file loading failed: ${error.message}`);
    await extractAndRenderCriteria("Embedded mock CRPF scenario");
    renderCriteria();
    runEvaluation("Mock CRPF scenario evaluated");
  }
}

function resetApp(clearInputs = true) {
  state.tenderText = "";
  state.tenderSource = null;
  state.criteria = [];
  state.bidders = [];
  state.audit = [];
  state.results = [];

  if (clearInputs) {
    document.getElementById("tender-file").value = "";
    document.getElementById("bidder-files").value = "";
  }

  document.getElementById("tender-summary").innerHTML =
    "Load the mock CRPF scenario or upload a tender to view extracted criteria.";
  document.getElementById("criteria-list").innerHTML = "No criteria available yet.";
  setHtmlIfPresent(
    "portfolio-summary",
    "Run an evaluation to see consolidated bidder counts, criterion outcomes, and review volume.",
  );
  setHtmlIfPresent(
    "manual-review-queue",
    "Ambiguous criteria will appear here with the exact document and reason for human review.",
  );
  renderEvaluationPlaceholder("Run an evaluation to see bidder verdicts.");
  document.getElementById("audit-log").innerHTML = "No audit events yet.";
  toggleReportActions(false);
  updateStatus();
}

async function handleTenderUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    state.tenderText = await readTenderText(file);
    state.tenderSource = file.name;
    pushAudit("Tender uploaded", `Loaded tender document ${file.name}.`);
    updateStatus();
    await extractAndRenderCriteria(file.name);
    renderCriteria();
  } catch (error) {
    pushAudit("Tender upload failed", `${file.name}: ${error.message}`);
    renderTenderRejection(file.name, error.message);
    renderEvaluationPlaceholder(`Tender upload failed: ${error.message}`);
  }
}

async function handleBidderUploads(event) {
  const files = Array.from(event.target.files);
  if (!files.length) return;

  state.bidders = [];
  try {
    for (const file of files) {
      const evidence = await readBidderEvidence(file);
      const normalized = await normalizeBidderEvidence(evidence, file.name);
      if (!normalized) {
        throw new Error(`${file.name} could not be normalized into bidder evidence.`);
      }
      state.bidders.push(normalized);
    }

    pushAudit("Bidder files uploaded", `Loaded ${files.length} bidder evidence file(s).`);
    updateStatus();
    renderEvaluationPlaceholder("Bidder evidence loaded. Click Run Evaluation.");
  } catch (error) {
    pushAudit("Bidder upload failed", error.message);
    renderEvaluationPlaceholder(`Bidder upload failed: ${error.message}`);
  }
}

function updateStatus() {
  const tenderLabel = state.tenderSource === "embedded_mock_crpf_scenario" ? "Mock CRPF scenario" : state.tenderSource;
  document.getElementById("tender-status").textContent = tenderLabel
    ? `${tenderLabel} loaded`
    : "No tender loaded";
  document.getElementById("bidder-status").textContent = state.bidders.length
    ? `${state.bidders.length} bidder submission(s) loaded`
    : "No bidder files loaded";
}

async function readTenderText(file) {
  if (isTextFile(file)) {
    const text = await file.text();
    await assertDocumentType(text, file.name, "tender");
    return text;
  }

  const analysis = await analyzeDocumentFile(file);
  await assertDocumentType(analysis.content || "", file.name, "tender");
  pushAudit(
    "Tender OCR completed",
    `Extracted ${analysis.pageCount} page(s) and ${analysis.tableCount} table(s) from ${file.name}.`,
  );
  return analysis.content || "";
}

async function readBidderEvidence(file) {
  if (isJsonFile(file)) {
    return JSON.parse(await file.text());
  }

  if (isTextFile(file)) {
    const text = await file.text();
    await assertDocumentType(text, file.name, "bidder", true);
    return text;
  }

  const analysis = await analyzeDocumentFile(file);
  await assertDocumentType(analysis.content || "", file.name, "bidder", true);
  pushAudit(
    "Bidder OCR completed",
    `Extracted ${analysis.pageCount} page(s) and ${analysis.tableCount} table(s) from ${file.name}.`,
  );
  return analysis.content || "";
}

async function assertDocumentType(text, source, expectedType, allowOtherAsReview = false) {
  const classification = await classifyDocumentText(text, source);

  if (classification.documentType === expectedType && classification.confidence >= 0.5) {
    pushAudit(
      "Document classified",
      `${source} classified as ${classification.documentType} (${Math.round(classification.confidence * 100)}%): ${classification.reason}`,
    );
    return classification;
  }

  if (allowOtherAsReview && classification.documentType === "other") {
    pushAudit(
      "Bidder document needs review",
      `${source} could not be confidently classified as bidder evidence: ${classification.reason}`,
    );
    return classification;
  }

  throw new Error(
    `${source} does not look like a ${expectedType} document. Classified as ${classification.documentType} (${Math.round(
      classification.confidence * 100,
    )}%): ${classification.reason}`,
  );
}

async function classifyDocumentText(text, source) {
  const response = await fetch(apiUrl("/api/ai/classify-document"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, source }),
  });

  const payload = await readApiPayload(response);
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "Document classification failed.");
  }

  return payload;
}

async function analyzeDocumentFile(file) {
  if (file.size > MAX_DOCUMENT_UPLOAD_BYTES) {
    throw new Error(`${file.name} is ${formatBytes(file.size)}. Upload documents must be 50 MB or smaller.`);
  }

  let response;
  try {
    response = await uploadDocumentWithFetch(file);
  } catch (error) {
    try {
      response = await uploadDocumentWithXhr(file);
    } catch (xhrError) {
      throw new Error(
        `Could not reach the local document-analysis API while uploading ${formatBytes(file.size)}. Restart the server with \`node server.js\`, then refresh this page. Browser error: ${xhrError.message}`,
      );
    }
  }

  const payload = await readApiPayload(response);
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "Document analysis failed.");
  }

  if (!payload.content) {
    throw new Error("Document Intelligence returned no text content.");
  }

  return payload;
}

async function uploadDocumentWithFetch(file) {
  const formData = new FormData();
  formData.append("document", file, file.name);

  return fetch(apiUrl("/api/analyze-document"), {
    method: "POST",
    body: formData,
  });
}

async function uploadDocumentWithXhr(file) {
  const formData = new FormData();
  formData.append("document", file, file.name);

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", apiUrl("/api/analyze-document"));
    request.responseType = "text";
    request.timeout = 180000;

    request.addEventListener("load", () => {
      resolve({
        ok: request.status >= 200 && request.status < 300,
        status: request.status,
        text: async () => request.responseText || "",
      });
    });

    request.addEventListener("error", () => reject(new Error("XMLHttpRequest network error.")));
    request.addEventListener("timeout", () => reject(new Error("XMLHttpRequest timed out.")));
    request.addEventListener("abort", () => reject(new Error("XMLHttpRequest was aborted.")));
    request.send(formData);
  });
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function isJsonFile(file) {
  return file.type === "application/json" || file.name.toLowerCase().endsWith(".json");
}

function isTextFile(file) {
  return file.type.startsWith("text/") || file.name.toLowerCase().endsWith(".txt");
}

function renderTenderSummary() {
  if (!state.tenderText) return;

  const summary = document.getElementById("tender-summary");
  const totalMandatory = state.criteria.filter((criterion) => criterion.mandatory).length;
  const categories = [...new Set(state.criteria.map((criterion) => criterion.category))];

  summary.innerHTML = `
    <div class="status-strip">
      <div>
        <p class="mini-label">Tender source</p>
        <p class="status-value">${escapeHtml(state.tenderSource || "Uploaded tender")}</p>
      </div>
      <div>
        <p class="mini-label">Criteria extracted</p>
        <p class="status-value">${state.criteria.length}</p>
      </div>
      <div>
        <p class="mini-label">Mandatory criteria</p>
        <p class="status-value">${totalMandatory}</p>
      </div>
      <div>
        <p class="mini-label">Categories</p>
        <p class="status-value">${escapeHtml(categories.join(", "))}</p>
      </div>
    </div>
  `;

  pushAudit("Criteria extracted", `Normalized ${state.criteria.length} criteria from tender.`);
}

function renderTenderRejection(fileName, message) {
  const summary = document.getElementById("tender-summary");
  summary.innerHTML = `
    <div class="tender-rejection">
      <div class="queue-top">
        <div>
          <p class="mini-label">Document check</p>
          <h3>${escapeHtml(fileName)}</h3>
        </div>
        <span class="result-chip status-ineligible">Not a Tender</span>
      </div>
      <p class="queue-title">Tender validation failed</p>
      <p class="queue-reason">${escapeHtml(message)}</p>
    </div>
  `;
}

async function extractAndRenderCriteria(source) {
  try {
    const response = await fetch(apiUrl("/api/ai/extract-criteria"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: state.tenderText,
        source,
      }),
    });
    const payload = await readApiPayload(response);

    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "AI extraction failed.");
    }

    if (payload.mode === "rejected_document") {
      throw new Error(payload.note || "The uploaded document does not look like a tender.");
    }

    state.criteria = payload.criteria && payload.criteria.length ? payload.criteria : extractCriteria(state.tenderText);
    pushAudit(
      isAiProviderMode(payload.mode) ? "AI criteria extraction completed" : "Rule criteria extraction completed",
      `Extracted ${state.criteria.length} criteria from ${source}.`,
    );
  } catch (error) {
    state.criteria = extractCriteria(state.tenderText);
    pushAudit("Criteria extraction fallback used", error.message);
  }

  renderTenderSummary();
}

async function normalizeBidderEvidence(evidence, source) {
  if (isStructuredBidderEvidence(evidence)) {
    pushAudit("Structured bidder evidence loaded", `Prepared bidder evidence from ${source}.`);
    return evidence;
  }

  if (typeof evidence === "string") {
    pushAudit("Bidder OCR text loaded", `Prepared extracted bidder text from ${source}.`);
    return {
      bidderName: source.replace(/\.[^.]+$/, ""),
      sourceDocument: source,
      extractedText: evidence,
    };
  }

  try {
    const response = await fetch(apiUrl("/api/ai/normalize-bidder"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evidence, source }),
    });
    const payload = await readApiPayload(response);

    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "AI normalization failed.");
    }

    pushAudit(
      isAiProviderMode(payload.mode) ? "AI bidder evidence normalized" : "Structured bidder evidence loaded",
      `Prepared bidder evidence from ${source}.`,
    );
    return payload.bidder || evidence;
  } catch (error) {
    pushAudit("Bidder evidence fallback used", `${source}: ${error.message}`);
    return evidence;
  }
}

function isStructuredBidderEvidence(evidence) {
  return Boolean(
    evidence &&
      typeof evidence === "object" &&
      evidence.bidderName &&
      evidence.documents &&
      evidence.documents.turnover &&
      Array.isArray(evidence.documents.projects) &&
      evidence.documents.gst &&
      evidence.documents.iso,
  );
}

function renderCriteria() {
  const container = document.getElementById("criteria-list");
  if (!state.criteria.length) {
    container.textContent = "No criteria available yet.";
    return;
  }

  const template = document.getElementById("criterion-template");
  const grid = document.createElement("div");
  grid.className = "criteria-grid";

  state.criteria.forEach((criterion) => {
    const node = template.content.cloneNode(true);
    node.querySelector(".criterion-badge").textContent = criterion.mandatory ? "Mandatory" : "Optional";
    node.querySelector(".criterion-tag").textContent = criterion.category;
    node.querySelector(".criterion-title").textContent = criterion.title;
    node.querySelector(".criterion-source").textContent = `Source: ${criterion.source}`;

    const meta = node.querySelector(".criterion-meta");
    meta.appendChild(detailPair("Rule type", criterion.type));
    meta.appendChild(detailPair("Threshold", criterion.thresholdLabel));
    meta.appendChild(detailPair("Evidence needed", criterion.evidenceNeeded));
    meta.appendChild(detailPair("Review trigger", criterion.reviewTrigger));

    grid.appendChild(node);
  });

  container.innerHTML = "";
  container.appendChild(grid);
}

async function runEvaluation(auditEvent = "Evaluation executed") {
  if (!state.tenderText || !state.bidders.length) {
    renderEvaluationPlaceholder("Load one tender and at least one bidder file before evaluation.");
    return;
  }

  if (state.bidders.some((bidder) => bidder.extractedText)) {
    await runAiEvaluation(auditEvent);
    return;
  }

  if (!state.criteria.length) {
    state.criteria = extractCriteria(state.tenderText);
  }

  state.results = state.bidders.map((bidder) => evaluateBidder(bidder, state.criteria));
  renderPortfolioSummary();
  renderManualReviewQueue();
  renderEvaluationResults(state.results);
  pushAudit(auditEvent, `Completed criterion-level evaluation for ${state.results.length} bidders.`);
  toggleReportActions(true);
}

async function runAiEvaluation(auditEvent) {
  renderEvaluationPlaceholder("Evaluating tender and bidder OCR with Amazon Bedrock...");

  try {
    const response = await fetch(apiUrl("/api/ai/evaluate-bidders"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenderText: state.tenderText,
        tenderSource: state.tenderSource,
        bidders: state.bidders.map((bidder) => ({
          bidderName: bidder.bidderName,
          sourceDocument: bidder.sourceDocument || bidder.bidderName,
          extractedText: bidder.extractedText || JSON.stringify(bidder, null, 2),
        })),
      }),
    });

    const payload = await readApiPayload(response);
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "AI bidder evaluation failed.");
    }

    state.criteria = payload.criteria && payload.criteria.length ? payload.criteria : state.criteria;
    state.results = payload.results || [];
    renderCriteria();
    renderPortfolioSummary();
    renderManualReviewQueue();
    renderEvaluationResults(state.results);
    pushAudit(
      "Amazon Bedrock evaluation completed",
      `Evaluated ${state.results.length} bidder submission(s) from OCR text.`,
    );
    toggleReportActions(true);
  } catch (error) {
    renderEvaluationPlaceholder(`Amazon Bedrock evaluation failed: ${escapeHtml(error.message)}`);
    pushAudit("Amazon Bedrock evaluation failed", error.message);
    if (state.bidders.every((bidder) => isStructuredBidderEvidence(bidder))) {
      state.results = state.bidders.map((bidder) => evaluateBidder(bidder, state.criteria));
      renderPortfolioSummary();
      renderManualReviewQueue();
      renderEvaluationResults(state.results);
      pushAudit(auditEvent, `Completed fallback rule evaluation for ${state.results.length} bidders.`);
      toggleReportActions(true);
    }
  }
}

function renderEvaluationPlaceholder(message) {
  document.getElementById("evaluation-results").innerHTML = message;
}

function renderEvaluationResults(results) {
  const container = document.getElementById("evaluation-results");
  const bidderTemplate = document.getElementById("bidder-template");
  const resultTemplate = document.getElementById("result-template");
  const grid = document.createElement("div");
  grid.className = "bidder-grid";

  results.forEach((result) => {
    const node = bidderTemplate.content.cloneNode(true);
    node.querySelector(".bidder-name").textContent = result.bidderName;

    const overallChip = node.querySelector(".overall-chip");
    overallChip.textContent = result.overall;
    overallChip.className = `overall-chip ${statusClass(result.overall)}`;

    const metrics = node.querySelector(".bidder-metrics");
    metrics.appendChild(metricPill(`Eligible: ${result.summary.eligible}`));
    metrics.appendChild(metricPill(`Not Eligible: ${result.summary.notEligible}`));
    metrics.appendChild(metricPill(`Manual Review: ${result.summary.review}`));

    const criteriaContainer = node.querySelector(".criteria-results");
    result.criteria.forEach((criterionResult) => {
      const resultNode = resultTemplate.content.cloneNode(true);
      resultNode.querySelector(".result-title").textContent = criterionResult.title;
      const chip = resultNode.querySelector(".result-chip");
      chip.textContent = criterionResult.verdict;
      chip.className = `result-chip ${statusClass(criterionResult.verdict)}`;

      resultNode.querySelector(".result-reason").textContent = criterionResult.reason;

      const detailGrid = resultNode.querySelector(".result-detail-grid");
      detailGrid.appendChild(detailBox("Criterion", criterionResult.criterion));
      detailGrid.appendChild(detailBox("Evidence", criterionResult.evidence));
      detailGrid.appendChild(detailBox("Source document", criterionResult.document));
      detailGrid.appendChild(detailBox("Decision logic", criterionResult.logic));

      criteriaContainer.appendChild(resultNode);
    });

    grid.appendChild(node);
  });

  container.innerHTML = "";
  container.appendChild(grid);
}

function renderPortfolioSummary() {
  const container = document.getElementById("portfolio-summary");
  if (!state.results.length) {
    container.textContent =
      "Run an evaluation to see consolidated bidder counts, criterion outcomes, and review volume.";
    return;
  }

  const summary = summarizeEvaluation(state.results);
  container.innerHTML = `
    <div class="dashboard-grid">
      ${summaryCard("Bidder outcomes", `${summary.overallEligible} eligible / ${summary.overallNotEligible} not eligible / ${summary.overallReview} review`)}
      ${summaryCard("Criterion outcomes", `${summary.criterionEligible} pass / ${summary.criterionNotEligible} fail / ${summary.criterionReview} review`)}
      ${summaryCard("Manual review queue", `${summary.manualReviewQueue.length} criterion-level escalations`)}
      ${summaryCard("Audit readiness", "Every verdict includes criterion, evidence, document, and decision logic.")}
    </div>
  `;
}

function renderManualReviewQueue() {
  const container = document.getElementById("manual-review-queue");
  if (!state.results.length) {
    container.textContent =
      "Ambiguous criteria will appear here with the exact document and reason for human review.";
    return;
  }

  const summary = summarizeEvaluation(state.results);
  if (!summary.manualReviewQueue.length) {
    container.innerHTML = '<div class="queue-empty">No manual-review items in the current evaluation.</div>';
    return;
  }

  const items = summary.manualReviewQueue
    .map(
      (item) => `
        <article class="queue-card">
          <div class="queue-top">
            <div>
              <p class="mini-label">Bidder</p>
              <h3>${escapeHtml(item.bidderName)}</h3>
            </div>
            <span class="result-chip status-review">Needs Manual Review</span>
          </div>
          <p class="queue-title">${escapeHtml(item.title)}</p>
          <p class="queue-reason">${escapeHtml(item.reason)}</p>
          <div class="result-detail-grid">
            ${detailBoxMarkup("Evidence", item.evidence)}
            ${detailBoxMarkup("Source document", item.document)}
          </div>
        </article>
      `,
    )
    .join("");

  container.innerHTML = `<div class="queue-grid">${items}</div>`;
}

function toggleReportActions(enabled) {
  const button = document.getElementById("export-report-btn");
  if (button) {
    button.disabled = !enabled;
  }
}

function exportReport() {
  if (!state.results.length) return;

  const report = buildEvaluationReport({
    tenderSource: state.tenderSource,
    criteria: state.criteria,
    results: state.results,
    audit: state.audit,
    solutionScope: [
      "Representative mock-data prototype for Round 1 and sandboxed Round 2 evaluation.",
      "Criterion-level explainability, manual-review routing, and audit logging implemented in the browser demo.",
      "Full OCR and document-normalization pipeline for PDF, scans, Word files, and photographs remains a production extension.",
    ],
  });

  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "tender-evaluation-report.json";
  anchor.click();
  URL.revokeObjectURL(url);

  pushAudit("Evaluation report exported", "Generated structured JSON report for procurement review.");
}

function renderAudit() {
  const container = document.getElementById("audit-log");
  if (!state.audit.length) {
    container.textContent = "No audit events yet.";
    return;
  }

  const list = document.createElement("div");
  list.className = "audit-list";

  [...state.audit].reverse().forEach((entry) => {
    const item = document.createElement("article");
    item.className = "audit-item";
    item.innerHTML = `
      <p class="mini-label">${escapeHtml(entry.timestamp)}</p>
      <h4>${escapeHtml(entry.event)}</h4>
      <p>${escapeHtml(entry.detail)}</p>
    `;
    list.appendChild(item);
  });

  container.innerHTML = "";
  container.appendChild(list);
}

function detailPair(label, value) {
  const wrapper = document.createElement("div");
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  wrapper.appendChild(dt);
  wrapper.appendChild(dd);
  return wrapper;
}

function detailBox(label, value) {
  const box = document.createElement("div");
  box.className = "detail-box";
  box.innerHTML = detailBoxMarkup(label, value);
  return box;
}

function detailBoxMarkup(label, value) {
  return `<strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span>`;
}

function metricPill(text) {
  const pill = document.createElement("div");
  pill.className = "metric-pill";
  pill.textContent = text;
  return pill;
}

function summaryCard(label, value) {
  return `
    <article class="summary-card">
      <p class="mini-label">${escapeHtml(label)}</p>
      <p class="summary-value">${escapeHtml(value)}</p>
    </article>
  `;
}

function setHtmlIfPresent(id, html) {
  const element = document.getElementById(id);
  if (element) {
    element.innerHTML = html;
  }
}

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

function isAiProviderMode(mode) {
  return mode === "bedrock";
}

async function readApiPayload(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return {
      error: response.ok ? "The server returned an invalid JSON response." : "API endpoint was not found.",
      detail: text,
    };
  }
}

function statusClass(status) {
  if (status === "Eligible") return "status-eligible";
  if (status === "Not Eligible") return "status-ineligible";
  return "status-review";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

toggleReportActions(false);
