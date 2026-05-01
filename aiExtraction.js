const { extractCriteria } = require("./core");

const DEFAULT_API_VERSION = "v1";

async function extractCriteriaWithAi(text, source = "uploaded tender") {
  if (!isAzureOpenAiConfigured()) {
    return {
      mode: "rule_fallback",
      source,
      criteria: extractCriteria(text),
      note: "Azure OpenAI is not configured; used deterministic rule extraction.",
    };
  }

  const payload = await callAzureOpenAi({
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
    mode: "azure_openai",
    source,
    criteria: normalizeCriteria(payload.criteria || []),
  };
}

async function normalizeBidderEvidenceWithAi(bidderOrText, source = "bidder evidence") {
  if (!isAzureOpenAiConfigured()) {
    return {
      mode: "structured_fallback",
      source,
      bidder: typeof bidderOrText === "string" ? null : bidderOrText,
      note: "Azure OpenAI is not configured; used submitted structured bidder evidence.",
    };
  }

  const evidenceText =
    typeof bidderOrText === "string" ? bidderOrText : JSON.stringify(bidderOrText, null, 2);

  const payload = await callAzureOpenAi({
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
    mode: "azure_openai",
    source,
    bidder: payload,
  };
}

async function callAzureOpenAi({ system, user }) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT.replace(/\/$/, "");
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || DEFAULT_API_VERSION;
  const url = `${endpoint}/openai/v1/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": process.env.AZURE_OPENAI_API_KEY,
    },
    body: JSON.stringify({
      model: deployment,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Azure OpenAI request failed: ${response.status} ${raw}`);
  }

  const data = JSON.parse(raw);
  const content = data.choices && data.choices[0] && data.choices[0].message.content;
  if (!content) {
    throw new Error("Azure OpenAI returned no message content.");
  }

  return JSON.parse(content);
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

function isAzureOpenAiConfigured() {
  return Boolean(
    process.env.AZURE_OPENAI_ENDPOINT &&
      process.env.AZURE_OPENAI_API_KEY &&
      process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
  );
}

module.exports = {
  extractCriteriaWithAi,
  isAzureOpenAiConfigured,
  normalizeBidderEvidenceWithAi,
};
