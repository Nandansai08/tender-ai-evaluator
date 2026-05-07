const state = {
  tenderText: "",
  tenderSource: null,
  tenderVersions: [], // Array of {version, fileName, text, extractedAt, changes}
  criteria: [],
  criteriaApproved: false,
  criteriaRejected: false,
  criteriaRejectionReason: "",
  criteriaReviewNote: "",
  criteriaReviewUpdatedAt: null,
  bidders: [],
  audit: [],
  results: [],
  amendmentHistory: [], // Track criteria changes across versions
};

const { buildEvaluationReport, extractCriteria, evaluateBidder, getEffectiveVerdict, summarizeEvaluation } = window.TenderEvaluatorCore;
const API_BASE_URL = "http://localhost:3000";

const MAX_DOCUMENT_UPLOAD_BYTES = 50 * 1024 * 1024;
document.getElementById("run-eval-btn").addEventListener("click", () => runEvaluation());
document.getElementById("reset-btn").addEventListener("click", resetApp);
document.getElementById("export-report-btn").addEventListener("click", exportReport);
document.getElementById("tender-file").addEventListener("change", handleTenderUpload);
document.getElementById("tender-amendments").addEventListener("change", handleAmendmentUpload);
document.getElementById("bidder-files").addEventListener("change", handleBidderUploads);

function pushAudit(event, detail) {
  state.audit.push({
    timestamp: new Date().toLocaleTimeString(),
    event,
    detail,
  });
  renderAudit();
}

function resetApp(clearInputs = true) {
  state.tenderText = "";
  state.tenderSource = null;
  state.criteria = [];
  state.tenderVersions = [];
  state.amendmentHistory = [];
  state.bidders = [];
  state.audit = [];
  state.results = [];

  if (clearInputs) {
    document.getElementById("tender-file").value = "";
    document.getElementById("tender-amendments").value = "";
    document.getElementById("bidder-files").value = "";
  }

  document.getElementById("tender-summary").innerHTML =
    "Upload a tender to view extracted criteria.";
  document.getElementById("criteria-list").innerHTML = "No criteria available yet.";
  setHtmlIfPresent(
    "amendment-history",
    "No amendments loaded yet.",
  );
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

  clearEvaluationOutputs("Tender document selected. Validating and extracting criteria...");
  state.criteria = [];
  state.tenderVersions = [];
  state.amendmentHistory = [];
  renderCriteria();

  try {
    state.tenderText = await readTenderText(file);
    state.tenderSource = file.name;
    
    // Initialize tender versions with main tender
    state.tenderVersions = [{
      version: 1,
      fileName: file.name,
      text: state.tenderText,
      extractedAt: new Date().toISOString(),
      changes: null,
    }];
    
    pushAudit("Tender uploaded", `Loaded tender document ${file.name}.`);
    updateStatus();
    await extractAndRenderCriteria(file.name);
    renderCriteria();
    renderAmendmentStatus();
    clearEvaluationOutputs("Load one tender and at least one bidder file before evaluation.");
  } catch (error) {
    state.tenderText = "";
    state.tenderSource = null;
    state.criteria = [];
    state.tenderVersions = [];
    state.amendmentHistory = [];
    pushAudit("Tender upload failed", `${file.name}: ${error.message}`);
    updateStatus();
    renderTenderRejection(file.name, error.message);
    renderCriteria();
    clearEvaluationOutputs(`Tender upload failed: ${error.message}`);
  }
}

async function extractCriteriaAi(text, source) {
  try {
    const response = await fetch(apiUrl("/api/ai/extract-criteria"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        source,
      }),
    });
    const payload = await readApiPayload(response);

    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "AI extraction failed.");
    }

    if (payload.mode === "rejected_document") {
      throw new Error(payload.note || "The document does not look like a tender.");
    }

    return payload;
  } catch (error) {
    // Fallback to rule-based extraction
    return {
      mode: "rule_fallback",
      criteria: extractCriteria(text),
      note: error.message,
    };
  }
}

function normalizeAmendmentCriteria(criteria) {
  return (Array.isArray(criteria) ? criteria : []).map((criterion, index) => ({
    id: criterion.id || `AMEND-${String(index + 1).padStart(3, "0")}`,
    title: criterion.title || "Untitled criterion",
    category: criterion.category || "Other",
    type: criterion.type || "other",
    mandatory: Boolean(criterion.mandatory),
    threshold: typeof criterion.threshold === "number" ? criterion.threshold : null,
    years: typeof criterion.years === "number" ? criterion.years : null,
    thresholdLabel: criterion.thresholdLabel || "Review extracted criterion",
    evidenceNeeded: criterion.evidenceNeeded || "Supporting evidence required",
    reviewTrigger: criterion.reviewTrigger || "Unclear or missing supporting evidence",
    source: criterion.source || "AI extracted",
  }));
}

async function handleAmendmentUpload(event) {
  const files = Array.from(event.target.files);
  if (!files.length) return;
  if (!state.tenderText) {
    alert("Please load the main tender document first before adding amendments.");
    return;
  }

  clearEvaluationOutputs("Processing tender amendments...");
  const baseVersionCount = state.tenderVersions.length;

  try {
    const amendments = [];
    for (const file of files) {
      const text = await readTenderText(file);
      amendments.push({ file: file.name, text });
    }

    // Add amendments as new versions
    for (let i = 0; i < amendments.length; i++) {
      const amendment = amendments[i];
      const versionNumber = baseVersionCount + i + 1;
      
      state.tenderVersions.push({
        version: versionNumber,
        fileName: amendment.file,
        text: amendment.text,
        extractedAt: new Date().toISOString(),
        changes: null,
      });
    }

    // Reconcile amendments with existing criteria
    await reconcileTenderAmendments();
    
    pushAudit("Tender amendments uploaded", `Added ${files.length} amendment document(s).`);
    updateStatus();
    await extractAndRenderCriteria("multiple versions");
    renderCriteria();
    renderAmendmentStatus();
    clearEvaluationOutputs("Amendment(s) processed. Review criteria changes in the panel below.");
  } catch (error) {
    pushAudit("Amendment upload failed", error.message);
    clearEvaluationOutputs(`Amendment processing failed: ${error.message}`);
  }
}

async function reconcileTenderAmendments() {
  if (state.tenderVersions.length < 2) return;

  const history = [];
  let previousCriteria = state.criteria || [];

  // Extract criteria from each version starting from version 2 (amendments)
  for (let i = 1; i < state.tenderVersions.length; i++) {
    const version = state.tenderVersions[i];
    
    // Extract criteria from amendment text
    const extractionResult = await extractCriteriaAi(version.text, version.fileName);
    const currentCriteria = normalizeAmendmentCriteria(extractionResult.criteria || []);

    // Detect changes from previous version
    const changes = detectCriteriaChanges(previousCriteria, currentCriteria, version.version);
    version.changes = changes;

    // Store amendment history
    history.push({
      version: version.version,
      fileName: version.fileName,
      changes,
      timestamp: version.extractedAt,
    });

    previousCriteria = currentCriteria;
  }

  state.amendmentHistory = history;

  // Apply amendments to create final criteria with provenance
  updateCriteriaWithProvenance();
}

function detectCriteriaChanges(previousCriteria, currentCriteria, versionNumber) {
  const changes = { added: [], modified: [], removed: [] };

  // Find added and modified
  currentCriteria.forEach((criterion) => {
    const previous = previousCriteria.find((c) => c.id === criterion.id);
    if (!previous) {
      changes.added.push({
        id: criterion.id,
        title: criterion.title,
        introducedInVersion: versionNumber,
      });
    } else if (JSON.stringify(previous) !== JSON.stringify(criterion)) {
      changes.modified.push({
        id: criterion.id,
        title: criterion.title,
        previousThreshold: previous.thresholdLabel,
        newThreshold: criterion.thresholdLabel,
        version: versionNumber,
      });
    }
  });

  // Find removed
  previousCriteria.forEach((previous) => {
    if (!currentCriteria.find((c) => c.id === previous.id)) {
      changes.removed.push({
        id: previous.id,
        title: previous.title,
        removedInVersion: versionNumber,
      });
    }
  });

  return changes;
}

function updateCriteriaWithProvenance() {
  // Update each criterion with provenance (which version it came from / modified in)
  state.criteria.forEach((criterion) => {
    let originVersion = 1;
    let lastModifiedVersion = 1;

    // Find which version introduced/last modified this criterion
    for (let i = 1; i < state.tenderVersions.length; i++) {
      const version = state.tenderVersions[i];
      if (version.changes) {
        if (version.changes.added.some((c) => c.id === criterion.id)) {
          originVersion = version.version;
          lastModifiedVersion = version.version;
        }
        if (version.changes.modified.some((c) => c.id === criterion.id)) {
          lastModifiedVersion = version.version;
        }
      }
    }

    criterion.originVersion = originVersion;
    criterion.lastModifiedVersion = lastModifiedVersion;
    criterion.amendment = originVersion > 1 ? `Added in v${originVersion}` : lastModifiedVersion > 1 ? `Modified in v${lastModifiedVersion}` : null;
  });
}

async function handleBidderUploads(event) {
  const files = Array.from(event.target.files);
  if (!files.length) return;

  clearEvaluationOutputs("Bidder evidence selected. Normalizing submission files...");
  state.bidders = [];
  try {
    for (const file of files) {
      const evidenceData = await readBidderEvidence(file);
      const normalized = await normalizeBidderEvidence(evidenceData.content, file.name, evidenceData.documentAnalysis);
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
  const tenderLabel = state.tenderSource;
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
    formatExtractionMessage(analysis, file.name),
  );
  return analysis.content || "";
}

async function readBidderEvidence(file) {
  if (isJsonFile(file)) {
    return {
      type: "json",
      content: JSON.parse(await file.text()),
      fileName: file.name,
      documentAnalysis: null,
    };
  }

  if (isTextFile(file)) {
    const text = await file.text();
    await assertDocumentType(text, file.name, "bidder", true);
    return {
      type: "text",
      content: text,
      fileName: file.name,
      documentAnalysis: null,
    };
  }

  const analysis = await analyzeDocumentFile(file);
  await assertDocumentType(analysis.content || "", file.name, "bidder", true);
  pushAudit(
    "Bidder OCR completed",
    formatExtractionMessage(analysis, file.name),
  );
  return {
    type: "document",
    content: analysis.content || "",
    fileName: file.name,
    documentAnalysis: {
      pages: analysis.pages || [],
      lineMapping: analysis.lineMapping || {},
      documentName: analysis.documentName || file.name,
      extractionMode: analysis.extractionMode,
      pageCount: analysis.pageCount,
      paragraphCount: analysis.paragraphCount,
    },
  };
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

  // For bidder documents, allow "tender" classification if reviewer is enabled
  // (bidder responses naturally reference tender criteria)
  if (allowOtherAsReview && classification.documentType === "tender" && expectedType === "bidder") {
    pushAudit(
      "Bidder document references tender criteria",
      `${source} mentions tender eligibility details but may be bidder evidence: ${classification.reason}. Will process with manual review enabled.`,
    );
    return { ...classification, documentType: "bidder", isAmbiguous: true };
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

function formatExtractionMessage(analysis, fileName) {
  // For Word documents (mammoth/word-extractor), show paragraph count
  if (analysis.extractionMode === "mammoth_docx" || analysis.extractionMode === "word_extractor_doc") {
    return `Extracted ${analysis.paragraphCount} paragraph(s) and ${analysis.lineCount} line(s) from ${fileName}.`;
  }
  // For Azure OCR (PDF, images, PPTX, XLSX), show page and table counts
  return `Extracted ${analysis.pageCount} page(s) and ${analysis.tableCount} table(s) from ${fileName}.`;
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
      <div>
        <p class="mini-label">Criteria review</p>
        <p class="status-value">${state.criteriaRejected ? "Rejected" : state.criteriaApproved ? "Approved" : "Pending approval"}</p>
      </div>
    </div>
  `;

  pushAudit("Criteria extracted", `Normalized ${state.criteria.length} criteria from tender.`);
}

function renderTenderRejection(fileName, message) {
  const summary = document.getElementById("tender-summary");
  summary.innerHTML = `
    <div class="tender-rejection">
      <p class="mini-label">Document check</p>
      <div class="queue-top">
        <div>
          <h3>${escapeHtml(fileName)}</h3>
          <p class="queue-reason">The uploaded file was rejected during tender validation.</p>
        </div>
        <span class="result-chip status-ineligible">Not a Tender</span>
      </div>
      <p class="queue-title">Tender validation failed</p>
      <div class="detail-box tender-rejection-detail">
        <strong>Validation detail</strong>
        <span>${escapeHtml(message)}</span>
      </div>
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
      "Criteria extraction completed",
      `Extracted ${state.criteria.length} criteria from ${source}.`,
    );
  } catch (error) {
    state.criteria = extractCriteria(state.tenderText);
    pushAudit("Criteria extraction fallback used", error.message);
  }

  renderTenderSummary();
}

async function normalizeBidderEvidence(evidence, source, documentAnalysis = null) {
  if (isStructuredBidderEvidence(evidence)) {
    pushAudit("Structured bidder evidence loaded", `Prepared bidder evidence from ${source}.`);
    // Add document analysis metadata if available
    if (documentAnalysis && evidence) {
      evidence.documentAnalysis = documentAnalysis;
    }
    return evidence;
  }

  if (typeof evidence === "string") {
    pushAudit("Bidder OCR text loaded", `Prepared extracted bidder text from ${source}.`);
    return {
      bidderName: source.replace(/\.[^.]+$/, ""),
      sourceDocument: source,
      extractedText: evidence,
      documentAnalysis: documentAnalysis,
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

    // Add document analysis metadata to normalized bidder
    if (documentAnalysis && payload.bidder) {
      payload.bidder.documentAnalysis = documentAnalysis;
    }

    pushAudit(
      isAiProviderMode(payload.mode) ? "AI bidder evidence normalized" : "Structured bidder evidence loaded",
      `Prepared bidder evidence from ${source}.`,
    );
    return payload.bidder || evidence;
  } catch (error) {
    pushAudit("Bidder evidence fallback used", `${source}: ${error.message}`);
    // Add document analysis metadata to fallback evidence
    if (documentAnalysis && typeof evidence === "string") {
      return {
        bidderName: source.replace(/\.[^.]+$/, ""),
        sourceDocument: source,
        extractedText: evidence,
        documentAnalysis: documentAnalysis,
      };
    }
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

    // Add amendment/version info if available
    if (criterion.amendment) {
      const amendmentBadge = document.createElement("div");
      amendmentBadge.className = "amendment-badge";
      amendmentBadge.style.marginTop = "8px";
      amendmentBadge.style.padding = "6px 10px";
      amendmentBadge.style.backgroundColor = "#fff3cd";
      amendmentBadge.style.borderLeft = "3px solid #ffc107";
      amendmentBadge.style.fontSize = "0.85rem";
      amendmentBadge.textContent = `📋 ${criterion.amendment}`;
      meta.appendChild(amendmentBadge);
    }

    grid.appendChild(node);
  });

  container.innerHTML = "";
  container.appendChild(grid);

  const approvalSection = document.createElement("div");
  approvalSection.className = "approval-section";
  
  if (state.criteriaRejected) {
    approvalSection.innerHTML = `
      <div class="rejection-status">
        <p class="mini-label">Criteria Status</p>
        <p class="status-value rejection-badge">✗ Rejected by officer</p>
        <p class="rejection-reason">Reason: ${escapeHtml(state.criteriaRejectionReason)}</p>
        ${state.criteriaReviewNote ? `<p class="review-note">Officer note: ${escapeHtml(state.criteriaReviewNote)}</p>` : ""}
      </div>
      <button id="re-extract-criteria-btn" class="secondary-btn">Re-extract Criteria</button>
    `;
  } else if (state.criteriaApproved) {
    approvalSection.innerHTML = `
      <div class="approval-status">
        <p class="mini-label">Criteria Review Status</p>
        <p class="status-value">✓ Approved by officer</p>
        ${state.criteriaReviewNote ? `<p class="review-note">Officer note: ${escapeHtml(state.criteriaReviewNote)}</p>` : ""}
      </div>
    `;
  } else {
    approvalSection.innerHTML = `
      <div class="approval-status">
        <p class="mini-label">Criteria Review Status</p>
        <p class="status-value">⊘ Pending approval</p>
      </div>
      <div class="approval-buttons">
        <button id="approve-criteria-btn" class="primary-btn">Approve Criteria</button>
        <button id="reject-criteria-btn" class="secondary-btn">Reject Criteria</button>
      </div>
    `;
  }
  
  container.appendChild(approvalSection);

  // Attach event listeners
  const approveBtn = document.getElementById("approve-criteria-btn");
  const rejectBtn = document.getElementById("reject-criteria-btn");
  const reExtractBtn = document.getElementById("re-extract-criteria-btn");

  if (approveBtn) {
    approveBtn.addEventListener("click", approveCriteria);
  }
  if (rejectBtn) {
    rejectBtn.addEventListener("click", showRejectDialog);
  }
  if (reExtractBtn) {
    reExtractBtn.addEventListener("click", reExtractCriteria);
  }
}

function renderAmendmentStatus() {
  const container = document.getElementById("amendment-history");
  if (!container) return; // Container doesn't exist yet in HTML
  
  if (state.tenderVersions.length <= 1) {
    container.innerHTML = "<p class=\"empty-state\">No amendments loaded yet.</p>";
    return;
  }

  let html = `
    <div class="amendment-list">
      <h4>Tender Versions (${state.tenderVersions.length} total)</h4>
  `;

  state.tenderVersions.forEach((version) => {
    html += `
      <div class="amendment-item">
        <div class="amendment-header">
          <span class="version-badge">v${version.version}</span>
          <span class="version-name">${escapeHtml(version.fileName)}</span>
          <span class="version-date">${new Date(version.extractedAt).toLocaleString()}</span>
        </div>
    `;

    if (version.changes && (version.changes.added.length > 0 || version.changes.modified.length > 0 || version.changes.removed.length > 0)) {
      html += `<div class="amendment-changes">`;
      
      if (version.changes.added.length > 0) {
        html += `<div class="change-group added">
          <strong class="change-label">+ Added (${version.changes.added.length}):</strong>
          ${version.changes.added.map((c) => `<div class="change-item">${escapeHtml(c.title)}</div>`).join("")}
        </div>`;
      }
      
      if (version.changes.modified.length > 0) {
        html += `<div class="change-group modified">
          <strong class="change-label">~ Modified (${version.changes.modified.length}):</strong>
          ${version.changes.modified.map((c) => `<div class="change-item">${escapeHtml(c.title)}: ${escapeHtml(c.previousThreshold)} → ${escapeHtml(c.newThreshold)}</div>`).join("")}
        </div>`;
      }
      
      if (version.changes.removed.length > 0) {
        html += `<div class="change-group removed">
          <strong class="change-label">- Removed (${version.changes.removed.length}):</strong>
          ${version.changes.removed.map((c) => `<div class="change-item">${escapeHtml(c.title)}</div>`).join("")}
        </div>`;
      }
      
      html += `</div>`;
    }

    html += `</div>`;
  });

  html += `</div>`;
  container.innerHTML = html;
}

function approveCriteria() {
  const note = prompt("Optional approval note for the procurement record:", state.criteriaReviewNote || "") || "";
  state.criteriaApproved = true;
  state.criteriaRejected = false;
  state.criteriaRejectionReason = "";
  state.criteriaReviewNote = note.trim();
  state.criteriaReviewUpdatedAt = new Date().toISOString();
  pushAudit(
    "Criteria approved",
    `Officer approved ${state.criteria.length} extracted criteria. Evaluation may now proceed.${state.criteriaReviewNote ? ` Note: ${state.criteriaReviewNote}` : ""}`,
  );
  renderCriteria();
}

function showRejectDialog() {
  const reason = prompt("Please provide a reason for rejecting these criteria:\n(e.g., 'Missing financial thresholds', 'Criteria do not match tender clauses')");
  if (reason !== null) {
    rejectCriteria(reason);
  }
}

function rejectCriteria(reason) {
  state.criteriaRejected = true;
  state.criteriaApproved = false;
  state.criteriaRejectionReason = reason.trim();
  state.criteriaReviewNote = state.criteriaRejectionReason;
  state.criteriaReviewUpdatedAt = new Date().toISOString();
  pushAudit(
    "Criteria rejected",
    `Officer rejected criteria. Reason: ${state.criteriaRejectionReason}`,
  );
  renderCriteria();
}

async function reExtractCriteria() {
  state.criteria = [];
  state.criteriaRejected = false;
  state.criteriaApproved = false;
  state.criteriaRejectionReason = "";
  state.criteriaReviewNote = "";
  state.criteriaReviewUpdatedAt = null;
  clearEvaluationOutputs("Criteria re-extraction in progress. Review and approve the refreshed criteria before evaluation.");
  if (state.tenderText) {
    await extractAndRenderCriteria(state.tenderSource || "uploaded tender");
  } else {
    renderCriteria();
  }
}

async function runEvaluation(auditEvent = "Evaluation executed") {
  if (!state.tenderText || !state.bidders.length) {
    renderEvaluationPlaceholder("Load one tender and at least one bidder file before evaluation.");
    return;
  }

  if (!state.criteria.length) {
    renderEvaluationPlaceholder("Extract criteria from the tender first.");
    return;
  }

  if (!state.criteriaApproved) {
    renderEvaluationPlaceholder("Review and approve the extracted criteria before running evaluation.");
    return;
  }

  if (state.bidders.some((bidder) => bidder.extractedText)) {
    await runAiEvaluation(auditEvent);
    return;
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

function clearEvaluationOutputs(message = "Run an evaluation to see bidder verdicts.") {
  state.results = [];
  state.criteriaApproved = false;
  state.criteriaRejected = false;
  state.criteriaRejectionReason = "";
  state.criteriaReviewNote = "";
  state.criteriaReviewUpdatedAt = null;
  setHtmlIfPresent(
    "portfolio-summary",
    "Run an evaluation to see consolidated bidder counts, criterion outcomes, and review volume.",
  );
  setHtmlIfPresent(
    "manual-review-queue",
    "Ambiguous criteria will appear here with the exact document and reason for human review.",
  );
  renderEvaluationPlaceholder(message);
  toggleReportActions(false);
}

function renderEvaluationResults(results) {
  refreshEvaluationResults();
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
      const effectiveVerdict = getEffectiveVerdict(criterionResult);
      chip.textContent = criterionResult.reviewOverride
        ? `${effectiveVerdict} (overridden)`
        : effectiveVerdict;
      chip.className = `result-chip ${statusClass(effectiveVerdict)}`;

      const reasonLine = resultNode.querySelector(".result-reason");
      reasonLine.textContent = criterionResult.reviewOverride
        ? `${criterionResult.reviewOverride.reason} ${criterionResult.reviewOverride.note ? `Note: ${criterionResult.reviewOverride.note}` : ""}`.trim()
        : criterionResult.reason;

      const detailGrid = resultNode.querySelector(".result-detail-grid");
      detailGrid.appendChild(detailBox("Criterion", criterionResult.criterion));
      detailGrid.appendChild(detailBox("Evidence", criterionResult.evidence));
      detailGrid.appendChild(detailBox("Source document", criterionResult.document));
      if (criterionResult.evidenceLocation) {
        const locationText = criterionResult.evidenceLocation.locationType === "page-range"
          ? `Page ${criterionResult.evidenceLocation.pageRange} of ${escapeHtml(criterionResult.evidenceLocation.documentName)}`
          : `${criterionResult.evidenceLocation.pageRange} in ${escapeHtml(criterionResult.evidenceLocation.documentName)}`;
        detailGrid.appendChild(detailBox("Evidence location", locationText));
      }
      detailGrid.appendChild(detailBox("Decision logic", criterionResult.logic));

      const actions = document.createElement("div");
      actions.className = "result-actions";
      actions.innerHTML = `
        <div>
          <p class="mini-label">Reviewer override</p>
          <p class="override-status">${criterionResult.reviewOverride ? `Current override: ${escapeHtml(criterionResult.reviewOverride.verdict)}` : "No override applied."}</p>
        </div>
        <div class="override-button-row">
          <button type="button" class="secondary-btn override-btn" data-verdict="Eligible">Mark Eligible</button>
          <button type="button" class="secondary-btn override-btn" data-verdict="Not Eligible">Mark Not Eligible</button>
          <button type="button" class="ghost-btn clear-override-btn">Clear Override</button>
        </div>
      `;

      const eligibleBtn = actions.querySelector('[data-verdict="Eligible"]');
      const notEligibleBtn = actions.querySelector('[data-verdict="Not Eligible"]');
      const clearBtn = actions.querySelector(".clear-override-btn");

      eligibleBtn.addEventListener("click", () => applyCriterionOverride(result.bidderName, criterionResult.title, "Eligible"));
      notEligibleBtn.addEventListener("click", () => applyCriterionOverride(result.bidderName, criterionResult.title, "Not Eligible"));
      clearBtn.addEventListener("click", () => clearCriterionOverride(result.bidderName, criterionResult.title));

      resultNode.appendChild(actions);

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

function refreshEvaluationResults() {
  state.results = state.results.map((result) => {
    const summary = {
      eligible: 0,
      notEligible: 0,
      review: 0,
    };

    result.criteria.forEach((criterionResult) => {
      const verdict = getEffectiveVerdict(criterionResult);
      if (verdict === "Eligible") summary.eligible += 1;
      if (verdict === "Not Eligible") summary.notEligible += 1;
      if (verdict === "Needs Manual Review") summary.review += 1;
    });

    let overall = "Eligible";
    if (summary.notEligible > 0) {
      overall = "Not Eligible";
    } else if (summary.review > 0) {
      overall = "Needs Manual Review";
    }

    return {
      ...result,
      summary,
      overall,
    };
  });
}

function applyCriterionOverride(bidderName, criterionTitle, verdict) {
  const note = prompt(`Optional officer note for ${criterionTitle}:`, "") || "";
  state.results = state.results.map((result) => {
    if (result.bidderName !== bidderName) return result;

    return {
      ...result,
      criteria: result.criteria.map((criterionResult) => {
        if (criterionResult.title !== criterionTitle) return criterionResult;

        return {
          ...criterionResult,
          reviewOverride: {
            verdict,
            reason:
              verdict === "Eligible"
                ? "Officer overrode the automated verdict to Eligible."
                : "Officer overrode the automated verdict to Not Eligible.",
            note: note.trim(),
            updatedAt: new Date().toISOString(),
          },
        };
      }),
    };
  });

  refreshEvaluationResults();
  renderPortfolioSummary();
  renderManualReviewQueue();
  renderEvaluationResults(state.results);
  pushAudit(
    "Criterion override applied",
    `${bidderName} - ${criterionTitle} set to ${verdict}${note.trim() ? ` with note: ${note.trim()}` : ""}`,
  );
}

function clearCriterionOverride(bidderName, criterionTitle) {
  state.results = state.results.map((result) => {
    if (result.bidderName !== bidderName) return result;

    return {
      ...result,
      criteria: result.criteria.map((criterionResult) => {
        if (criterionResult.title !== criterionTitle) return criterionResult;
        if (!criterionResult.reviewOverride) return criterionResult;

        const { reviewOverride, ...rest } = criterionResult;
        return rest;
      }),
    };
  });

  refreshEvaluationResults();
  renderPortfolioSummary();
  renderManualReviewQueue();
  renderEvaluationResults(state.results);
  pushAudit("Criterion override cleared", `${bidderName} - ${criterionTitle}`);
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
    tenderVersions: state.tenderVersions,
    amendmentHistory: state.amendmentHistory,
    criteria: state.criteria,
    criteriaReview: {
      approved: state.criteriaApproved,
      rejected: state.criteriaRejected,
      rejectionReason: state.criteriaRejectionReason,
      note: state.criteriaReviewNote,
      updatedAt: state.criteriaReviewUpdatedAt,
    },
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
