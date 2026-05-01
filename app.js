const state = {
  tenderText: "",
  tenderSource: null,
  criteria: [],
  bidders: [],
  audit: [],
};

const { extractCriteria, evaluateBidder } = window.TenderEvaluatorCore;

const samplePaths = {
  tender: "./data/tender_sample.txt",
  bidders: [
    "./data/bidders/alpha_builders.json",
    "./data/bidders/bravo_infra.json",
    "./data/bidders/civic_structures.json",
  ],
};

document.getElementById("load-sample-btn").addEventListener("click", loadSampleScenario);
document.getElementById("run-eval-btn").addEventListener("click", runEvaluation);
document.getElementById("reset-btn").addEventListener("click", resetApp);
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
  resetApp(false);

  const [tenderResponse, ...bidderResponses] = await Promise.all([
    fetch(samplePaths.tender),
    ...samplePaths.bidders.map((path) => fetch(path)),
  ]);

  state.tenderText = await tenderResponse.text();
  state.tenderSource = "tender_sample.txt";
  state.bidders = await Promise.all(bidderResponses.map((response) => response.json()));

  updateStatus();
  pushAudit("Sample dataset loaded", "Loaded tender_sample.txt and 3 bidder files.");
  renderTenderSummary();
  renderCriteria();
  renderEvaluationPlaceholder("Sample dataset loaded. Click Run Evaluation.");
}

function resetApp(clearInputs = true) {
  state.tenderText = "";
  state.tenderSource = null;
  state.criteria = [];
  state.bidders = [];
  state.audit = [];

  if (clearInputs) {
    document.getElementById("tender-file").value = "";
    document.getElementById("bidder-files").value = "";
  }

  document.getElementById("tender-summary").innerHTML =
    "Load sample data or upload a tender to view extracted criteria.";
  document.getElementById("criteria-list").innerHTML = "No criteria available yet.";
  renderEvaluationPlaceholder("Run an evaluation to see bidder verdicts.");
  document.getElementById("audit-log").innerHTML = "No audit events yet.";
  updateStatus();
}

async function handleTenderUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  state.tenderText = await file.text();
  state.tenderSource = file.name;
  pushAudit("Tender uploaded", `Loaded tender file ${file.name}.`);
  updateStatus();
  renderTenderSummary();
  renderCriteria();
}

async function handleBidderUploads(event) {
  const files = Array.from(event.target.files);
  if (!files.length) return;

  state.bidders = [];
  for (const file of files) {
    const content = await file.text();
    state.bidders.push(JSON.parse(content));
  }

  pushAudit("Bidder files uploaded", `Loaded ${files.length} bidder submission files.`);
  updateStatus();
  renderEvaluationPlaceholder("Bidder files loaded. Click Run Evaluation.");
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

  state.criteria = extractCriteria(state.tenderText);

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

  const results = state.bidders.map((bidder) => evaluateBidder(bidder, state.criteria));
  renderEvaluationResults(results);
  pushAudit("Evaluation executed", `Completed criterion-level evaluation for ${results.length} bidders.`);
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
  box.innerHTML = `<strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span>`;
  return box;
}

function metricPill(text) {
  const pill = document.createElement("div");
  pill.className = "metric-pill";
  pill.textContent = text;
  return pill;
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
