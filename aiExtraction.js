const { extractCriteria } = require("./core");

const DEFAULT_BEDROCK_REGION = "us-east-1";
const DEFAULT_BEDROCK_MODEL_ID = "amazon.nova-lite-v1:0";
const BEDROCK_TIMEOUT_MS = 120000;

async function extractCriteriaWithAi(text, source = "uploaded tender") {
  const provider = getConfiguredAiProvider();
  if (!provider) {
    return {
      mode: "rule_fallback",
      source,
      criteria: extractCriteria(text),
      note: "No chat AI provider is configured; used deterministic rule extraction.",
    };
  }

  try {
    const classification = await classifyDocumentWithAi(text, source);
    if (classification.documentType !== "tender" || classification.confidence < 0.55) {
      return {
        mode: "rejected_document",
        source,
        criteria: [],
        note: classification.reason || "The uploaded document does not look like a tender document.",
      };
    }

    const payload = await provider.call({
      system:
        "You extract government tender eligibility criteria. Return only JSON. Prefer conservative manual-review triggers when wording is ambiguous.",
      user: `Extract mandatory and optional eligibility criteria from this tender text.

Return JSON with this shape:
{
  "criteria": [
    {
      "id": "string",
      "title": "string",
      "category": "Financial | Technical | Compliance | Certification | Document | Other",
      "type": "threshold | count_with_time_window | document_presence | certification | other",
      "mandatory": true,
      "threshold": number_or_null,
      "years": number_or_null,
      "thresholdLabel": "string",
      "evidenceNeeded": "string",
      "reviewTrigger": "string",
      "source": "clause/page reference if present"
    }
  ]
}

Tender source: ${source}
Tender text:
${text}`,
    });

    return {
      mode: provider.mode,
      source,
      criteria: normalizeCriteria(payload.criteria || []),
    };
  } catch (error) {
    return {
      mode: "rule_fallback",
      source,
      criteria: extractCriteria(text),
      note: `${provider.mode} extraction failed; used deterministic rule extraction. ${error.message}`,
    };
  }
}

async function classifyDocumentWithAi(text, source = "uploaded document") {
  const provider = getConfiguredAiProvider();
  if (!provider) {
    return classifyDocumentWithRules(text, source);
  }

  try {
    const payload = await provider.call({
      system:
        "Classify procurement documents. Return only JSON. Be conservative: if the document is a fee schedule, academic notice, invoice, brochure, unrelated form, or generic policy, classify it as other.",
      user: `Classify this OCR text.

Return JSON:
{
  "documentType": "tender | bidder | other",
  "confidence": number_between_0_and_1,
  "reason": "short reason"
}

Source: ${source}
OCR text:
${text.slice(0, 12000)}`,
    });

    return normalizeClassification(payload);
  } catch (error) {
    const fallback = classifyDocumentWithRules(text, source);
    fallback.reason = `${fallback.reason} AI classification failed: ${error.message}`;
    return fallback;
  }
}

async function normalizeBidderEvidenceWithAi(bidderOrText, source = "bidder evidence") {
  const provider = getConfiguredAiProvider();
  if (!provider) {
    return {
      mode: "structured_fallback",
      source,
      bidder: typeof bidderOrText === "string" ? null : bidderOrText,
      note: "No chat AI provider is configured; used submitted structured bidder evidence.",
    };
  }

  const evidenceText =
    typeof bidderOrText === "string" ? bidderOrText : JSON.stringify(bidderOrText, null, 2);

  try {
    const payload = await provider.call({
      system:
        "You normalize bidder evidence for a government tender eligibility engine. Return only JSON. Do not invent evidence.",
      user: `Normalize this bidder evidence into the JSON shape expected by the evaluator.

Return JSON with this shape:
{
  "bidderName": "string",
  "documents": {
    "turnover": {
      "valueCrore": number_or_null,
      "confidence": number_between_0_and_1,
      "conflicting": boolean,
      "document": "source document name"
    },
    "projects": [
      { "name": "string", "similarity": "high | medium | low", "completed": boolean }
    ],
    "gst": {
      "present": boolean,
      "valid": boolean,
      "number": "string",
      "document": "source document name"
    },
    "iso": {
      "present": boolean,
      "valid": boolean,
      "confidence": number_between_0_and_1,
      "certificateId": "string",
      "document": "source document name"
    }
  }
}

Bidder evidence source: ${source}
Bidder evidence:
${evidenceText}`,
    });

    return {
      mode: provider.mode,
      source,
      bidder: payload,
    };
  } catch (error) {
    return {
      mode: "structured_fallback",
      source,
      bidder: typeof bidderOrText === "string" ? null : bidderOrText,
      note: `${provider.mode} normalization failed; used submitted structured evidence. ${error.message}`,
    };
  }
}

async function evaluateTenderBiddersWithAi({ tenderText, tenderSource, bidders }) {
  const provider = getConfiguredAiProvider();
  if (!provider) {
    throw new Error("Amazon Bedrock is not configured.");
  }

  const payload = await provider.call({
    system:
      "You are a government tender eligibility evaluator. Use only the provided tender and bidder evidence. Return only JSON. Do not invent criteria. If the tender text is not a tender/RFP/bid/procurement notice, return empty criteria and empty results. If bidder evidence is unrelated or insufficient, use Needs Manual Review instead of guessing.",
    user: `Evaluate each bidder against the tender requirements.

Return JSON with this exact shape:
{
  "criteria": [
    {
      "id": "string",
      "title": "string",
      "category": "Financial | Technical | Compliance | Certification | Document | Other",
      "type": "threshold | count_with_time_window | document_presence | certification | other",
      "mandatory": true,
      "threshold": number_or_null,
      "years": number_or_null,
      "thresholdLabel": "string",
      "evidenceNeeded": "string",
      "reviewTrigger": "string",
      "source": "clause/page reference if present"
    }
  ],
  "results": [
    {
      "bidderName": "string",
      "overall": "Eligible | Not Eligible | Needs Manual Review",
      "summary": { "eligible": 0, "notEligible": 0, "review": 0 },
      "criteria": [
        {
          "title": "string",
          "criterion": "string",
          "verdict": "Eligible | Not Eligible | Needs Manual Review",
          "reason": "string",
          "evidence": "quoted or summarized bidder evidence",
          "document": "source bidder document name",
          "logic": "short decision logic"
        }
      ]
    }
  ]
}

Tender source: ${tenderSource || "uploaded tender"}
Tender OCR text:
${tenderText}

Bidder OCR/evidence:
${JSON.stringify(bidders, null, 2)}`,
  });

  const criteria = normalizeCriteria(payload.criteria || []);
  const results = normalizeEvaluationResults(payload.results || []);
  return {
    mode: provider.mode,
    criteria,
    results,
  };
}

function getConfiguredAiProvider() {
  if (isBedrockConfigured()) {
    return {
      mode: "bedrock",
      call: callBedrockConverse,
    };
  }

  return null;
}

async function callBedrockConverse({ system, user }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BEDROCK_TIMEOUT_MS);
  const region = process.env.BEDROCK_REGION || process.env.AWS_REGION || DEFAULT_BEDROCK_REGION;
  const modelId = process.env.BEDROCK_MODEL_ID || DEFAULT_BEDROCK_MODEL_ID;
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse`;

  const response = await fetch(url, {
    method: "POST",
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.AWS_BEARER_TOKEN_BEDROCK}`,
    },
    body: JSON.stringify({
      system: [{ text: system }],
      messages: [
        {
          role: "user",
          content: [{ text: user }],
        },
      ],
      inferenceConfig: {
        maxTokens: Number(process.env.BEDROCK_MAX_TOKENS || 4096),
        temperature: Number(process.env.BEDROCK_TEMPERATURE || 0.1),
        topP: Number(process.env.BEDROCK_TOP_P || 0.95),
      },
    }),
  }).finally(() => clearTimeout(timeout));

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Amazon Bedrock request failed: ${response.status} ${raw}`);
  }

  const data = JSON.parse(raw);
  const contentItems = data.output && data.output.message && data.output.message.content;
  const content = Array.isArray(contentItems)
    ? contentItems.map((item) => item.text || "").join("")
    : "";
  if (!content) {
    throw new Error("Amazon Bedrock returned no message content.");
  }

  return parseJsonObject(content);
}

function parseJsonObject(content) {
  try {
    return JSON.parse(content);
  } catch (error) {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw error;
  }
}

function normalizeCriteria(criteria) {
  return criteria.map((criterion, index) => ({
    id: criterion.id || `AI-${String(index + 1).padStart(3, "0")}`,
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

function normalizeClassification(payload) {
  const allowed = ["tender", "bidder", "other"];
  const documentType = allowed.includes(payload.documentType) ? payload.documentType : "other";
  const confidence =
    typeof payload.confidence === "number" && Number.isFinite(payload.confidence)
      ? Math.max(0, Math.min(1, payload.confidence))
      : 0;

  return {
    documentType,
    confidence,
    reason: payload.reason || "No classification reason returned.",
  };
}

function classifyDocumentWithRules(text, source = "uploaded document") {
  const normalized = text.toLowerCase();
  const tenderSignals = [
    "tender",
    "request for proposal",
    "rfp",
    "bidder",
    "bidders",
    "eligibility criteria",
    "technical bid",
    "financial bid",
    "earnest money",
    "emd",
    "work order",
    "scope of work",
  ];
  const bidderSignals = [
    "turnover",
    "gst",
    "iso 9001",
    "completion certificate",
    "work experience",
    "audited financial",
  ];
  const negativeSignals = [
    "fee structure",
    "tuition fee",
    "semester",
    "ph.d",
    "under graduate",
    "post graduate",
    "course",
    "admission",
  ];

  const tenderScore = tenderSignals.filter((signal) => normalized.includes(signal)).length;
  const bidderScore = bidderSignals.filter((signal) => normalized.includes(signal)).length;
  const negativeScore = negativeSignals.filter((signal) => normalized.includes(signal)).length;

  if (negativeScore >= 2 && tenderScore < 2) {
    return {
      documentType: "other",
      confidence: 0.8,
      reason: `${source} appears to be an academic/fee document, not a tender or bidder submission.`,
    };
  }

  if (tenderScore >= 2) {
    return {
      documentType: "tender",
      confidence: Math.min(0.95, 0.45 + tenderScore * 0.12),
      reason: "Tender/procurement terms were found.",
    };
  }

  if (bidderScore >= 2) {
    return {
      documentType: "bidder",
      confidence: Math.min(0.9, 0.45 + bidderScore * 0.12),
      reason: "Bidder evidence terms were found.",
    };
  }

  return {
    documentType: "other",
    confidence: 0.6,
    reason: "Not enough tender or bidder evidence signals were found.",
  };
}

function normalizeEvaluationResults(results) {
  return results.map((result) => {
    const criteria = Array.isArray(result.criteria) ? result.criteria : [];
    const normalizedCriteria = criteria.map((item) => ({
      title: item.title || "Untitled criterion",
      criterion: item.criterion || "Review tender requirement",
      verdict: normalizeVerdict(item.verdict),
      reason: item.reason || "No reason returned.",
      evidence: item.evidence || "No evidence cited.",
      document: item.document || "N/A",
      logic: item.logic || "AI evaluation",
    }));

    const summary = {
      eligible: normalizedCriteria.filter((item) => item.verdict === "Eligible").length,
      notEligible: normalizedCriteria.filter((item) => item.verdict === "Not Eligible").length,
      review: normalizedCriteria.filter((item) => item.verdict === "Needs Manual Review").length,
    };

    return {
      bidderName: result.bidderName || "Unnamed bidder",
      overall: normalizeVerdict(result.overall || deriveOverall(summary)),
      summary,
      criteria: normalizedCriteria,
    };
  });
}

function deriveOverall(summary) {
  if (summary.notEligible > 0) return "Not Eligible";
  if (summary.review > 0) return "Needs Manual Review";
  return "Eligible";
}

function normalizeVerdict(verdict) {
  if (verdict === "Eligible" || verdict === "Not Eligible" || verdict === "Needs Manual Review") {
    return verdict;
  }
  return "Needs Manual Review";
}

function isBedrockConfigured() {
  return Boolean(process.env.AWS_BEARER_TOKEN_BEDROCK);
}

module.exports = {
  classifyDocumentWithAi,
  evaluateTenderBiddersWithAi,
  extractCriteriaWithAi,
  isBedrockConfigured,
  normalizeBidderEvidenceWithAi,
};
