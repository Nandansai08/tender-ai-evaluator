const http = require("http");
const fs = require("fs");
const path = require("path");
const {
  extractCriteriaWithAi,
  normalizeBidderEvidenceWithAi,
} = require("./aiExtraction");
const { analyzeDocumentBuffer } = require("./documentIntelligence");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

http
  .createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/api/analyze-document") {
      await handleDocumentAnalysis(req, res);
      return;
    }

    if (req.method === "POST" && req.url === "/api/ai/extract-criteria") {
      await handleAiCriteriaExtraction(req, res);
      return;
    }

    if (req.method === "POST" && req.url === "/api/ai/normalize-bidder") {
      await handleAiBidderNormalization(req, res);
      return;
    }

    const requestPath = req.url === "/" ? "/index.html" : req.url;
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
      res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
      res.end(content);
    });
  })
  .listen(PORT, () => {
    console.log(`AI Tender Evaluator available at http://localhost:${PORT}`);
  });

async function handleDocumentAnalysis(req, res) {
  try {
    const chunks = [];
    let receivedBytes = 0;

    for await (const chunk of req) {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_UPLOAD_BYTES) {
        writeJson(res, 413, { error: "Document is larger than the 10 MB demo upload limit." });
        return;
      }
      chunks.push(chunk);
    }

    if (!chunks.length) {
      writeJson(res, 400, { error: "No document was uploaded." });
      return;
    }

    const result = await analyzeDocumentBuffer(Buffer.concat(chunks));
    writeJson(res, 200, result);
  } catch (error) {
    writeJson(res, 500, {
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

async function readJsonBody(req) {
  const chunks = [];
  let receivedBytes = 0;

  for await (const chunk of req) {
    receivedBytes += chunk.length;
    if (receivedBytes > MAX_UPLOAD_BYTES) {
      throw new Error("Request body is larger than the 10 MB demo limit.");
    }
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
