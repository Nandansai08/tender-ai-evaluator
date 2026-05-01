const state = {
  tenderText: "",
  tenderSource: null,
  criteria: [],
  bidders: [],
  audit: [],
  results: [],
};

const { buildEvaluationReport, extractCriteria, evaluateBidder, summarizeEvaluation } = window.TenderEvaluatorCore;

const samplePaths = {
  tender: "./data/tender_sample.txt",
  bidders: [
    "./data/bidders/alpha_builders.json",
    "./data/bidders/bravo_infra.json",
    "./data/bidders/civic_structures.json",
  ],
};

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
document.getElementById("run-eval-btn").addEventListener("click", runEvaluation);
document.getElementById("reset-btn").addEventListener("click", resetApp);
document.getElementById("export-report-btn").addEventListener("click", exportReport);
document.getElementById("tender-file").addEventListener("change", handleTenderUpload);
document.getElementById("bidder-files").addEventListener("change", handleBidderUploads);
document.getElementById("document-ai-file").addEventListener("change", handleDocumentAiUpload);

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
    renderEvaluationPlaceholder("Mock CRPF scenario loaded. Run the evaluation to generate verdicts.");
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
    renderEvaluationPlaceholder("Mock CRPF scenario loaded. Run the evaluation to generate verdicts.");
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
  setHtmlIfPresent("document-ai-result", "Upload a document to see extracted OCR and layout details.");
  renderEvaluationPlaceholder("Run an evaluation to see bidder verdicts.");
  document.getElementById("audit-log").innerHTML = "No audit events yet.";
  toggleReportActions(false);
  updateStatus();
}

async function handleTenderUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  state.tenderText = await file.text();
  state.tenderSource = file.name;
  pushAudit("Tender uploaded", `Loaded tender file ${file.name}.`);
  updateStatus();
  await extractAndRenderCriteria(file.name);
  renderCriteria();
}

async function handleBidderUploads(event) {
  const files = Array.from(event.target.files);
  if (!files.length) return;

  state.bidders = [];
  for (const file of files) {
    const content = await file.text();
    const parsedBidder = JSON.parse(content);
    const normalized = await normalizeBidderEvidence(parsedBidder, file.name);
    state.bidders.push(normalized);
  }

  pushAudit("Bidder files uploaded", `Loaded ${files.length} bidder submission files.`);
  updateStatus();
  renderEvaluationPlaceholder("Bidder files loaded. Click Run Evaluation.");
}

async function handleDocumentAiUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const resultContainer = document.getElementById("document-ai-result");
  resultContainer.textContent = `Analyzing ${file.name} with Azure AI Document Intelligence...`;

  try {
    const response = await fetch("/api/analyze-document", {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-Document-Name": encodeURIComponent(file.name),
      },
      body: file,
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Document analysis failed.");
    }

    renderDocumentAiResult(file.name, payload);
    pushAudit(
      "AI document extraction completed",
      `Analyzed ${file.name}: ${payload.pageCount} page(s), ${payload.tableCount} table(s).`,
    );
  } catch (error) {
    const message =
      error instanceof TypeError && error.message === "Failed to fetch"
        ? "Could not reach the TenderWiseAi backend. Start the Node server with `node server.js`, or deploy/push the backend changes to Azure first."
        : error.message;
    resultContainer.innerHTML = `
      <div class="error-box">
        <strong>Document analysis failed</strong>
        <span>${escapeHtml(message)}</span>
      </div>
    `;
    pushAudit("AI document extraction failed", message);
  }
}

function updateStatus() {
  document.getElementById("tender-status").textContent = state.tenderSource
    ? `${state.tenderSource} loaded`
    : "No tender loaded";
  document.getElementById("bidder-status").textContent = state.bidders.length
    ? `${state.bidders.length} bidder file(s) loaded`
    : "No bidder files loaded";
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

async function extractAndRenderCriteria(source) {
  try {
    const response = await fetch("/api/ai/extract-criteria", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: state.tenderText,
        source,
      }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "AI extraction failed.");
    }

    state.criteria = payload.criteria && payload.criteria.length ? payload.criteria : extractCriteria(state.tenderText);
    pushAudit(
      payload.mode === "azure_openai" ? "AI criteria extraction completed" : "Rule criteria extraction completed",
      `Extracted ${state.criteria.length} criteria from ${source}.`,
    );
  } catch (error) {
    state.criteria = extractCriteria(state.tenderText);
    pushAudit("Criteria extraction fallback used", error.message);
  }

  renderTenderSummary();
}

async function normalizeBidderEvidence(evidence, source) {
  try {
    const response = await fetch("/api/ai/normalize-bidder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evidence, source }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "AI normalization failed.");
    }

    pushAudit(
      payload.mode === "azure_openai" ? "AI bidder evidence normalized" : "Structured bidder evidence loaded",
      `Prepared bidder evidence from ${source}.`,
    );
    return payload.bidder || evidence;
  } catch (error) {
    pushAudit("Bidder evidence fallback used", `${source}: ${error.message}`);
    return evidence;
  }
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

function runEvaluation() {
  if (!state.tenderText || !state.bidders.length) {
    renderEvaluationPlaceholder("Load one tender and at least one bidder file before evaluation.");
    return;
  }

  if (!state.criteria.length) {
    state.criteria = extractCriteria(state.tenderText);
  }

  state.results = state.bidders.map((bidder) => evaluateBidder(bidder, state.criteria));
  renderPortfolioSummary();
  renderManualReviewQueue();
  renderEvaluationResults(state.results);
  pushAudit("Evaluation executed", `Completed criterion-level evaluation for ${state.results.length} bidders.`);
  toggleReportActions(true);
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

function renderDocumentAiResult(fileName, payload) {
  const preview = payload.content ? payload.content.slice(0, 700) : "No text content returned.";
  const container = document.getElementById("document-ai-result");

  container.innerHTML = `
    <div class="document-result">
      <div class="dashboard-grid">
        ${summaryCard("File", fileName)}
        ${summaryCard("Pages", String(payload.pageCount))}
        ${summaryCard("Tables", String(payload.tableCount))}
        ${summaryCard("Paragraphs", String(payload.paragraphCount))}
      </div>
      <div class="ocr-preview">
        <p class="mini-label">Extracted text preview</p>
        <pre>${escapeHtml(preview)}</pre>
      </div>
    </div>
  `;
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
