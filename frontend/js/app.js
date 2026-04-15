/* ─── Tender AI Evaluator — Frontend Application ──────────────────────────── */

const API = '';  // same origin

// ─── State ────────────────────────────────────────────────────────────────────
let currentTenderId = null;
let addedBidders = [];   // [{bidder_id, name}]

// ─── Page routing ─────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    btn.classList.add('active');
    const page = btn.dataset.page;
    document.getElementById(`page-${page}`).classList.remove('hidden');
    if (page === 'reports') loadReports();
    if (page === 'audit')   loadAudit();
    if (page === 'evaluate') loadTenderSelect();
  });
});

// ─── File drag-and-drop helpers ───────────────────────────────────────────────
function setupFileDrop(dropId, inputId, displayId, multiple = false) {
  const drop = document.getElementById(dropId);
  const input = document.getElementById(inputId);
  const display = document.getElementById(displayId);

  drop.addEventListener('click', () => input.click());
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('drag-over');
    if (multiple) {
      input.files = e.dataTransfer.files;
    } else {
      const dt = new DataTransfer();
      dt.items.add(e.dataTransfer.files[0]);
      input.files = dt.files;
    }
    updateFileDisplay(input, display);
  });
  input.addEventListener('change', () => updateFileDisplay(input, display));
}

function updateFileDisplay(input, display) {
  if (!input.files || !input.files.length) return;
  const names = Array.from(input.files).map(f => `📄 ${f.name}`).join(', ');
  display.textContent = names;
  display.classList.remove('hidden');
}

setupFileDrop('tender-drop', 'tender-file', 'tender-file-name');
setupFileDrop('bidder-drop', 'bidder-files', 'bidder-file-names', true);

// ─── Tender upload ─────────────────────────────────────────────────────────────
document.getElementById('tender-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('tender-name').value.trim();
  const file = document.getElementById('tender-file').files[0];
  if (!name || !file) { showError('upload-error', 'Please provide a tender name and document.'); return; }

  showSpinner('upload-spinner', true);
  hideEl('upload-error');
  hideEl('criteria-result');
  hideEl('bidder-section');
  setLoading('tender-submit', true);

  const fd = new FormData();
  fd.append('tender_name', name);
  fd.append('file', file);

  try {
    const res = await fetch(`${API}/api/tender/upload`, { method: 'POST', body: fd });
    if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Upload failed'); }
    const data = await res.json();
    currentTenderId = data.tender_id;
    addedBidders = [];
    renderCriteriaResult(data);
    showEl('bidder-section');
    document.getElementById('bidders-added').innerHTML = '';
  } catch (err) {
    showError('upload-error', err.message);
  } finally {
    showSpinner('upload-spinner', false);
    setLoading('tender-submit', false);
  }
});

function renderCriteriaResult(data) {
  showEl('criteria-result');
  document.getElementById('tender-id-display').textContent = `ID: ${data.tender_id.substring(0, 8)}…`;

  const summaryEl = document.getElementById('criteria-summary');
  const mandatory = data.criteria.filter(c => c.mandatory === 'mandatory').length;
  const optional = data.criteria.length - mandatory;
  summaryEl.innerHTML = `
    <div class="summary-item"><div class="count">${data.criteria.length}</div><div class="label">Total Criteria</div></div>
    <div class="summary-item"><div class="count">${mandatory}</div><div class="label">Mandatory</div></div>
    <div class="summary-item"><div class="count">${optional}</div><div class="label">Optional</div></div>
    <div class="summary-item"><div class="count">${Math.round(data.extraction_confidence * 100)}%</div><div class="label">AI Confidence</div></div>
  `;

  const listEl = document.getElementById('criteria-list');
  listEl.innerHTML = data.criteria.map(c => `
    <div class="criterion-card">
      <div>
        <div class="criterion-badge">${c.criterion_id}</div>
      </div>
      <div class="criterion-info">
        <div class="criterion-name">${escHtml(c.name)}</div>
        <div class="criterion-desc">${escHtml(c.description)}</div>
        <div class="criterion-meta">
          <span class="criterion-tag">${c.criterion_type}</span>
          <span class="criterion-tag verdict-badge ${c.mandatory === 'mandatory' ? 'verdict-not_eligible' : 'verdict-eligible'}">${c.mandatory}</span>
          ${c.threshold_value ? `<span class="criterion-tag">Threshold: ${escHtml(c.threshold_value)} ${escHtml(c.unit || '')}</span>` : ''}
        </div>
      </div>
    </div>
  `).join('');
}

// ─── Bidder upload ─────────────────────────────────────────────────────────────
document.getElementById('bidder-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!currentTenderId) { showError('upload-error', 'Please upload a tender first.'); return; }
  const name = document.getElementById('bidder-name').value.trim();
  const files = document.getElementById('bidder-files').files;
  if (!name || !files.length) { showError('upload-error', 'Please provide a bidder name and at least one document.'); return; }

  showSpinner('upload-spinner', true);
  hideEl('upload-error');
  setLoading('bidder-submit', true);

  const fd = new FormData();
  fd.append('tender_id', currentTenderId);
  fd.append('bidder_name', name);
  Array.from(files).forEach(f => fd.append('files', f));

  try {
    const res = await fetch(`${API}/api/bidder/upload`, { method: 'POST', body: fd });
    if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Upload failed'); }
    const data = await res.json();
    addedBidders.push({ bidder_id: data.bidder_id, name: data.bidder_name });
    renderBidderChips();
    document.getElementById('bidder-name').value = '';
    document.getElementById('bidder-files').value = '';
    document.getElementById('bidder-file-names').classList.add('hidden');
  } catch (err) {
    showError('upload-error', err.message);
  } finally {
    showSpinner('upload-spinner', false);
    setLoading('bidder-submit', false);
  }
});

function renderBidderChips() {
  const el = document.getElementById('bidders-added');
  el.innerHTML = `<p style="font-size:0.85rem;font-weight:600;color:var(--primary);margin-bottom:6px">✅ Bidders Added (${addedBidders.length}):</p>`
    + addedBidders.map(b => `<span class="bidder-chip">🏢 ${escHtml(b.name)}</span>`).join('');
}

// ─── Evaluate page ─────────────────────────────────────────────────────────────
async function loadTenderSelect() {
  const sel = document.getElementById('eval-tender-select');
  try {
    const res = await fetch(`${API}/api/tenders`);
    const data = await res.json();
    sel.innerHTML = '<option value="">— select a tender —</option>'
      + data.map(t => `<option value="${t.tender_id}">${escHtml(t.name)} (${t.criteria_count} criteria)</option>`).join('');
  } catch { sel.innerHTML = '<option value="">— failed to load —</option>'; }
}

document.getElementById('run-eval-btn').addEventListener('click', async () => {
  const tenderId = document.getElementById('eval-tender-select').value;
  if (!tenderId) { showError('eval-error', 'Please select a tender.'); return; }

  showSpinner('eval-spinner', true);
  hideEl('eval-error');
  hideEl('eval-result');
  setLoading('run-eval-btn', true);

  try {
    const res = await fetch(`${API}/api/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tender_id: tenderId, bidder_ids: [] }),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Evaluation failed'); }
    const evalResult = await res.json();

    // Fetch full report
    const rRes = await fetch(`${API}/api/report/${evalResult.report_id}`);
    const report = await rRes.json();
    renderEvalResult(evalResult, report);
    showEl('eval-result');
  } catch (err) {
    showError('eval-error', err.message);
  } finally {
    showSpinner('eval-spinner', false);
    setLoading('run-eval-btn', false);
  }
});

function renderEvalResult(summary, report) {
  // Summary card
  document.getElementById('eval-summary-card').innerHTML = `
    <div class="card-header"><h2>📊 Evaluation Complete — ${escHtml(report.tender_name)}</h2>
      <a href="/api/report/${report.report_id}/pdf" target="_blank" class="btn btn-sm" style="background:white;color:var(--primary);margin-left:auto;">
        ⬇ Download PDF
      </a>
    </div>
    <div class="eval-summary-grid">
      <div class="eval-stat stat-total"><div class="count">${summary.total_bidders}</div><div class="label">Total Bidders</div></div>
      <div class="eval-stat stat-eligible"><div class="count">${summary.eligible_count}</div><div class="label">Eligible</div></div>
      <div class="eval-stat stat-not"><div class="count">${summary.not_eligible_count}</div><div class="label">Not Eligible</div></div>
      <div class="eval-stat stat-review"><div class="count">${summary.review_count}</div><div class="label">Needs Review</div></div>
    </div>
  `;

  // Per-bidder cards
  const container = document.getElementById('eval-bidders');
  container.innerHTML = report.bidder_evaluations.map(b => renderBidderCard(b)).join('');

  // Toggle criterion details
  container.querySelectorAll('.crit-eval-header').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const detail = hdr.nextElementSibling;
      const chev = hdr.querySelector('.crit-eval-chevron');
      detail.classList.toggle('open');
      chev.classList.toggle('open');
    });
  });
}

function renderBidderCard(b) {
  const vc = verdictClass(b.overall_verdict);
  const vi = verdictIcon(b.overall_verdict);
  const vl = verdictLabel(b.overall_verdict);

  const flaggedHtml = b.flagged_criteria && b.flagged_criteria.length
    ? `<div class="flagged-notice">⚠️ Flagged for Manual Review: ${b.flagged_criteria.join(', ')}</div>` : '';

  const criteriaHtml = b.criterion_evaluations.map(ce => {
    const cvc = verdictClass(ce.verdict);
    const cvi = verdictIcon(ce.verdict);
    const evidenceHtml = ce.evidence && ce.evidence.length ? ce.evidence.map(ev => `
      <div class="evidence-block">
        <div class="evidence-label">📎 Evidence from: ${escHtml(ev.document_name)}</div>
        <div class="evidence-value">Value: ${escHtml(ev.extracted_value || '—')}</div>
        <div class="evidence-source">"${escHtml(ev.source_text || '')}"</div>
      </div>
    `).join('') : '';

    const reviewReason = ce.review_reason
      ? `<div style="margin-top:6px;font-size:0.8rem;color:var(--review)">⚠ ${escHtml(ce.review_reason)}</div>` : '';

    return `
      <div class="crit-eval-row">
        <div class="crit-eval-header">
          <span class="crit-eval-id">${escHtml(ce.criterion_id)}</span>
          <span class="crit-eval-name">${escHtml(ce.criterion_name)}</span>
          <span class="verdict-badge verdict-${ce.verdict}">${cvi} ${verdictLabel(ce.verdict)}</span>
          <span class="crit-eval-conf">${Math.round(ce.confidence * 100)}%</span>
          <span class="crit-eval-chevron">▶</span>
        </div>
        <div class="crit-eval-detail">
          <div class="explanation-text">${escHtml(ce.explanation)}</div>
          ${reviewReason}
          ${evidenceHtml}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="bidder-eval-card">
      <div class="bidder-eval-header ${vc}">
        <span class="bidder-name">🏢 ${escHtml(b.bidder_name)}</span>
        <span class="verdict-badge verdict-${b.overall_verdict}">${vi} ${vl}</span>
        <span class="bidder-conf">Confidence: ${Math.round(b.overall_confidence * 100)}%</span>
      </div>
      <div class="bidder-eval-body">
        <div class="overall-explanation">${escHtml(b.overall_explanation)}</div>
        ${flaggedHtml}
        <div>${criteriaHtml}</div>
      </div>
    </div>
  `;
}

function verdictClass(v) {
  return { eligible: 'eligible', not_eligible: 'not_eligible', needs_review: 'needs_review' }[v] || '';
}
function verdictIcon(v) {
  return { eligible: '✅', not_eligible: '❌', needs_review: '⚠️' }[v] || '?';
}
function verdictLabel(v) {
  return { eligible: 'Eligible', not_eligible: 'Not Eligible', needs_review: 'Needs Review' }[v] || v;
}

// ─── Reports page ──────────────────────────────────────────────────────────────
async function loadReports() {
  const el = document.getElementById('reports-list');
  try {
    const res = await fetch(`${API}/api/reports`);
    const data = await res.json();
    if (!data.length) { el.innerHTML = '<p class="muted">No reports generated yet.</p>'; return; }
    el.innerHTML = `<table class="data-table">
      <thead><tr><th>Report ID</th><th>Tender ID</th><th>Generated</th><th>Actions</th></tr></thead>
      <tbody>${data.map(r => `
        <tr>
          <td class="mono">${r.report_id.substring(0, 8)}…</td>
          <td class="mono">${r.tender_id.substring(0, 8)}…</td>
          <td>${new Date(r.created_at).toLocaleString()}</td>
          <td>
            <a href="/api/report/${r.report_id}/pdf" target="_blank" class="btn btn-sm btn-outline">⬇ PDF</a>
          </td>
        </tr>
      `).join('')}</tbody>
    </table>`;
  } catch { el.innerHTML = '<p class="muted">Failed to load reports.</p>'; }
}

// ─── Audit log page ────────────────────────────────────────────────────────────
async function loadAudit() {
  const el = document.getElementById('audit-list');
  try {
    const res = await fetch(`${API}/api/audit?limit=200`);
    const data = await res.json();
    if (!data.length) { el.innerHTML = '<p class="muted">No audit entries yet.</p>'; return; }
    el.innerHTML = `<table class="data-table">
      <thead><tr><th>Timestamp</th><th>Event</th><th>Entity Type</th><th>Entity ID</th><th>Details</th></tr></thead>
      <tbody>${data.map(a => `
        <tr>
          <td class="mono">${new Date(a.timestamp).toLocaleString()}</td>
          <td><strong>${escHtml(a.event_type)}</strong></td>
          <td>${escHtml(a.entity_type)}</td>
          <td class="mono">${a.entity_id.substring(0, 8)}…</td>
          <td class="mono">${escHtml(JSON.stringify(a.details))}</td>
        </tr>
      `).join('')}</tbody>
    </table>`;
  } catch { el.innerHTML = '<p class="muted">Failed to load audit log.</p>'; }
}

// ─── Utilities ─────────────────────────────────────────────────────────────────
function showEl(id) { document.getElementById(id).classList.remove('hidden'); }
function hideEl(id) { document.getElementById(id).classList.add('hidden'); }
function showSpinner(id, show) { document.getElementById(id).classList.toggle('hidden', !show); }
function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = `⚠ ${msg}`;
  el.classList.remove('hidden');
}
function setLoading(id, loading) {
  const el = document.getElementById(id);
  if (el) el.disabled = loading;
}
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
