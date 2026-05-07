const http = require("http");
const fs = require("fs");
const path = require("path");

loadLocalEnv();

const {
  classifyDocumentWithAi,
  evaluateTenderBiddersWithAi,
  extractCriteriaWithAi,
  normalizeBidderEvidenceWithAi,
} = require("./aiExtraction");
const { analyzeDocumentBuffer } = require("./documentIntelligence");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_JSON_UPLOAD_BYTES = 75 * 1024 * 1024;
const MULTIPART_BOUNDARY_PREFIX = "boundary=";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

http
  .createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (requestUrl.pathname.startsWith("/api/")) {
      setCorsHeaders(res);
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/analyze-document") {
      console.log(`Document analysis request received: ${req.headers["content-type"] || "unknown content type"}`);
      await handleDocumentAnalysis(req, res);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/analyze-document-json") {
      await handleDocumentAnalysisJson(req, res);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/ai/extract-criteria") {
      await handleAiCriteriaExtraction(req, res);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/ai/normalize-bidder") {
      await handleAiBidderNormalization(req, res);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/ai/evaluate-bidders") {
      await handleAiBidderEvaluation(req, res);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/ai/classify-document") {
      await handleAiDocumentClassification(req, res);
      return;
    }

    const requestPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
    const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(ROOT, safePath);

    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        res.writeHead(error.code === "ENOENT" ? 404 : 500);
        res.end(error.code === "ENOENT" ? "Not found" : "Server error");
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(content);
    });
  })
  .listen(PORT, () => {
    console.log(`AI Tender Evaluator available at http://localhost:${PORT}`);
  });

async function handleDocumentAnalysis(req, res) {
  try {
    const body = await readRequestBuffer(req);
    const uploadedDocument = isMultipartRequest(req)
      ? extractMultipartFile(body, req.headers["content-type"])
      : {
          buffer: body,
          fileName: getRequestDocumentName(req),
          contentType: String(req.headers["x-document-type"] || "application/octet-stream").toLowerCase(),
        };
    const { buffer } = uploadedDocument;

    if (!buffer.length) {
      writeJson(res, 400, { error: "No document was uploaded." });
      return;
    }

    console.log(`Document analysis upload: ${uploadedDocument.fileName} (${formatMegabytes(buffer.length)} MB)`);
    const result = await analyzeDocumentBuffer(buffer, {
      fileName: uploadedDocument.fileName,
      contentType: uploadedDocument.contentType,
    });
    writeJson(res, 200, result);
  } catch (error) {
    writeJson(res, error.message.startsWith("Unsupported document format") ? 400 : 500, {
      error: "Document analysis failed.",
      detail: error.message,
    });
  }
}

async function readRequestBuffer(req) {
  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > MAX_UPLOAD_BYTES) {
    req.resume();
    throw new Error("Document is larger than the 50 MB upload limit.");
  }

  const chunks = [];
  let receivedBytes = 0;
  for await (const chunk of req) {
    receivedBytes += chunk.length;
    if (receivedBytes > MAX_UPLOAD_BYTES) {
      req.resume();
      throw new Error("Document is larger than the 50 MB upload limit.");
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function isMultipartRequest(req) {
  return (req.headers["content-type"] || "").toLowerCase().startsWith("multipart/form-data");
}

function extractMultipartFile(body, contentType = "") {
  const boundaryIndex = contentType.indexOf(MULTIPART_BOUNDARY_PREFIX);
  if (boundaryIndex === -1) {
    throw new Error("Multipart upload boundary is missing.");
  }

  const boundary = `--${contentType.slice(boundaryIndex + MULTIPART_BOUNDARY_PREFIX.length).trim()}`;
  const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"));
  if (headerEnd === -1) {
    throw new Error("Multipart upload body is malformed.");
  }

  const headerBlock = body.subarray(0, headerEnd).toString("utf8");
  const fileNameMatch = headerBlock.match(/filename="([^"]+)"/i);
  const fileNameStarMatch = headerBlock.match(/filename\*=([^\r\n;]+)/i);
  const contentTypeMatch = headerBlock.match(/content-type:\s*([^\r\n;]+)/i);

  const fileStart = headerEnd + 4;
  const fileEndMarker = Buffer.from(`\r\n${boundary}`);
  const fileEnd = body.indexOf(fileEndMarker, fileStart);
  if (fileEnd === -1) {
    throw new Error("Multipart upload file boundary is missing.");
  }

  return {
    buffer: body.subarray(fileStart, fileEnd),
    fileName: resolveMultipartFileName(fileNameMatch, fileNameStarMatch),
    contentType: contentTypeMatch ? contentTypeMatch[1].trim().toLowerCase() : "application/octet-stream",
  };
}

function resolveMultipartFileName(fileNameMatch, fileNameStarMatch) {
  if (fileNameMatch && fileNameMatch[1]) {
    return fileNameMatch[1];
  }

  if (fileNameStarMatch && fileNameStarMatch[1]) {
    const rawValue = fileNameStarMatch[1].trim();
    const stripped = rawValue.replace(/^utf-8''/i, "").replace(/^"|"$/g, "");
    try {
      return decodeURIComponent(stripped);
    } catch {
      return stripped;
    }
  }

  return "uploaded document";
}

function getRequestDocumentName(req) {
  const encoded = req.headers["x-document-name"];
  return encoded ? decodeURIComponent(encoded) : "uploaded document";
}

async function handleDocumentAnalysisJson(req, res) {
  try {
    const body = await readJsonBody(req, MAX_JSON_UPLOAD_BYTES);
    if (!body.dataBase64) {
      writeJson(res, 400, { error: "Document payload is required." });
      return;
    }

    const buffer = Buffer.from(body.dataBase64, "base64");
    console.log(
      `Document analysis upload: ${body.fileName || "unnamed document"} (${formatMegabytes(buffer.length)} MB)`,
    );
    if (!buffer.length) {
      writeJson(res, 400, { error: "Document payload is empty." });
      return;
    }

    if (buffer.length > MAX_UPLOAD_BYTES) {
      writeJson(res, 413, { error: "Document is larger than the 50 MB upload limit." });
      return;
    }

    const result = await analyzeDocumentBuffer(buffer, {
      fileName: body.fileName || "uploaded document",
      contentType: String(body.mimeType || "application/octet-stream").toLowerCase(),
    });
    writeJson(res, 200, result);
  } catch (error) {
    writeJson(res, error.message.startsWith("Unsupported document format") ? 400 : 500, {
      error: "Document analysis failed.",
      detail: error.message,
    });
  }
}

async function handleAiCriteriaExtraction(req, res) {
  try {
    const body = await readJsonBody(req);
    if (!body.text) {
      writeJson(res, 400, { error: "Tender text is required." });
      return;
    }

    const result = await extractCriteriaWithAi(body.text, body.source);
    writeJson(res, 200, result);
  } catch (error) {
    writeJson(res, 500, {
      error: "AI criteria extraction failed.",
      detail: error.message,
    });
  }
}

async function handleAiBidderNormalization(req, res) {
  try {
    const body = await readJsonBody(req);
    if (!body.evidence) {
      writeJson(res, 400, { error: "Bidder evidence is required." });
      return;
    }

    const result = await normalizeBidderEvidenceWithAi(body.evidence, body.source);
    writeJson(res, 200, result);
  } catch (error) {
    writeJson(res, 500, {
      error: "AI bidder evidence normalization failed.",
      detail: error.message,
    });
  }
}

async function handleAiBidderEvaluation(req, res) {
  try {
    const body = await readJsonBody(req, MAX_JSON_UPLOAD_BYTES);
    if (!body.tenderText || !Array.isArray(body.bidders) || !body.bidders.length) {
      writeJson(res, 400, { error: "Tender text and bidder evidence are required." });
      return;
    }

    const result = await evaluateTenderBiddersWithAi({
      tenderText: body.tenderText,
      tenderSource: body.tenderSource,
      bidders: body.bidders,
    });
    writeJson(res, 200, result);
  } catch (error) {
    writeJson(res, 500, {
      error: "AI bidder evaluation failed.",
      detail: error.message,
    });
  }
}

async function handleAiDocumentClassification(req, res) {
  try {
    const body = await readJsonBody(req, MAX_JSON_UPLOAD_BYTES);
    if (!body.text) {
      writeJson(res, 400, { error: "Document text is required." });
      return;
    }

    const result = await classifyDocumentWithAi(body.text, body.source);
    writeJson(res, 200, result);
  } catch (error) {
    writeJson(res, 500, {
      error: "Document classification failed.",
      detail: error.message,
    });
  }
}

async function readJsonBody(req, maxBytes = MAX_UPLOAD_BYTES) {
  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > maxBytes) {
    req.resume();
    throw new Error(`Request body is larger than the ${formatMegabytes(maxBytes)} MB limit.`);
  }

  const chunks = [];
  let receivedBytes = 0;

  for await (const chunk of req) {
    receivedBytes += chunk.length;
    if (receivedBytes > maxBytes) {
      req.resume();
      throw new Error(`Request body is larger than the ${formatMegabytes(maxBytes)} MB limit.`);
    }
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function formatMegabytes(bytes) {
  return Math.round(bytes / 1024 / 1024);
}

function writeJson(res, statusCode, payload) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Document-Name, X-Document-Type");
}

function loadLocalEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
