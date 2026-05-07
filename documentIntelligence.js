const {
  AzureKeyCredential,
  DocumentAnalysisClient,
} = require("@azure/ai-form-recognizer");
const mammoth = require("mammoth");
const WordExtractor = require("word-extractor");

const SUPPORTED_ANALYSIS_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/tiff",
  "image/bmp",
  "image/heif",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/html",
]);

function createDocumentClient() {
  const endpoint = process.env.DOCUMENT_INTELLIGENCE_ENDPOINT;
  const key = process.env.DOCUMENT_INTELLIGENCE_KEY;

  if (!endpoint || !key) {
    throw new Error("Document Intelligence endpoint or key is not configured.");
  }

  return new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));
}

async function analyzeDocumentBuffer(buffer, options = {}) {
  if (isDocxDocument(options)) {
    return analyzeMammothBuffer(buffer, options);
  }

  if (isLegacyDocFile(options)) {
    return analyzeWordBuffer(buffer, options);
  }

  const contentType = normalizeContentType(options);
  try {
    const client = createDocumentClient();
    if (!SUPPORTED_ANALYSIS_CONTENT_TYPES.has(contentType)) {
      throw new Error(
        `Unsupported document format for OCR: ${options.fileName || "uploaded document"}. ` +
          "Use PDF, images, DOCX, XLSX, PPTX, or HTML.",
      );
    }

    const poller = await client.beginAnalyzeDocument("prebuilt-layout", buffer, {
      contentType,
    });
    const result = await poller.pollUntilDone();

    return {
      content: result.content || "",
      pageCount: result.pages ? result.pages.length : 0,
      tableCount: result.tables ? result.tables.length : 0,
      paragraphCount: result.paragraphs ? result.paragraphs.length : 0,
      pages: (result.pages || []).map((page) => ({
        pageNumber: page.pageNumber,
        width: page.width,
        height: page.height,
        unit: page.unit,
        lineCount: page.lines ? page.lines.length : 0,
        wordCount: page.words ? page.words.length : 0,
      })),
      tables: (result.tables || []).map((table, index) => ({
        index,
        rowCount: table.rowCount,
        columnCount: table.columnCount,
        cells: table.cells.map((cell) => ({
          rowIndex: cell.rowIndex,
          columnIndex: cell.columnIndex,
          content: cell.content,
        })),
      })),
    };
  } catch (error) {
    throw error;
  }
}

async function analyzeMammothBuffer(buffer, options = {}) {
  const result = await mammoth.extractRawText({ buffer });
  const content = (result.value || "").trim();
  
  if (!content) {
    throw new Error(
      `No readable text was extracted from ${options.fileName || "the uploaded Word document"}. ` +
        "The file may be password-protected or image-only.",
    );
  }

  const paragraphs = content
    .split(/\r?\n\s*\r?\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const lines = content
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  // Build synthetic page mapping: group paragraphs into logical "pages" (every ~50 lines per page)
  const syntheticPages = buildSyntheticPages(lines, paragraphs, 50);

  return {
    content,
    pageCount: 0,
    tableCount: 0,
    paragraphCount: paragraphs.length,
    pages: syntheticPages,
    tables: [],
    extractionMode: "mammoth_docx",
    sourceType: normalizeContentType(options),
    lineCount: lines.length,
    lineMapping: createLineMapping(lines),
    documentName: options.fileName || "document",
  };
}

async function analyzeWordBuffer(buffer, options = {}) {
  const extractor = new WordExtractor();
  const document = await extractor.extract(buffer);
  const body = (document.getBody() || "").trim();
  const headers = (document.getHeaders({ includeFooters: false }) || "").trim();
  const footers = (document.getFooters() || "").trim();
  const textboxes = (document.getTextboxes() || "").trim();

  const content = [headers, body, textboxes, footers].filter(Boolean).join("\n\n").trim();
  if (!content) {
    throw new Error(
      `No readable text was extracted from ${options.fileName || "the uploaded Word document"}. ` +
        "The file may be password-protected or image-only.",
    );
  }

  const paragraphs = content
    .split(/\r?\n\s*\r?\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const lines = content
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  // Build synthetic page mapping: group paragraphs into logical "pages" (every ~50 lines per page)
  const syntheticPages = buildSyntheticPages(lines, paragraphs, 50);

  return {
    content,
    pageCount: 0,
    tableCount: 0,
    paragraphCount: paragraphs.length,
    pages: syntheticPages,
    tables: [],
    extractionMode: "word_extractor_doc",
    sourceType: normalizeContentType(options),
    lineCount: lines.length,
    lineMapping: createLineMapping(lines),
    documentName: options.fileName || "document",
  };
}

// Helper: Build synthetic page mapping for word-based documents (mammoth, word-extractor)
// Groups lines into logical pages for evidence tracking
function buildSyntheticPages(lines, paragraphs, linesPerPage = 50) {
  const pages = [];
  let currentPage = 1;
  let lineCount = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lineCount >= linesPerPage && i > 0) {
      currentPage++;
      lineCount = 0;
    }
    lineCount++;
  }

  // Return simplified page info with line ranges
  if (lines.length === 0) return [];
  
  const pagesResult = [];
  for (let p = 1; p <= currentPage; p++) {
    const startLine = (p - 1) * linesPerPage + 1;
    const endLine = Math.min(p * linesPerPage, lines.length);
    pagesResult.push({
      pageNumber: p,
      startLine,
      endLine,
      lineCount: endLine - startLine + 1,
    });
  }
  return pagesResult;
}

// Helper: Create a mapping of text snippets to line numbers for quick lookup
function createLineMapping(lines) {
  const mapping = {};
  lines.forEach((line, idx) => {
    // Use first 50 chars of line as key
    const key = line.substring(0, 50).toLowerCase();
    if (!mapping[key]) {
      mapping[key] = [];
    }
    mapping[key].push({
      lineNumber: idx + 1,
      text: line,
    });
  });
  return mapping;
}

// Helper: Find the line number and page of a given text snippet in extracted content
function findEvidenceLocation(text, lineMapping, pages) {
  if (!text || !lineMapping || !pages) {
    return { page: 1, lineRange: "unknown", snippet: text };
  }

  const searchKey = text.substring(0, 50).toLowerCase();
  const matches = lineMapping[searchKey] || [];
  
  if (matches.length === 0) {
    return { page: 1, lineRange: "unknown", snippet: text };
  }

  const firstMatch = matches[0];
  const lineNum = firstMatch.lineNumber;

  // Find which page this line falls on
  let page = 1;
  for (const p of pages) {
    if (lineNum >= p.startLine && lineNum <= p.endLine) {
      page = p.pageNumber;
      break;
    }
  }

  return {
    page,
    lineRange: `${lineNum}`,
    snippet: text.substring(0, 100),
  };
}

// .docx files use mammoth (purpose-built for DOCX text extraction).
// Azure Document Intelligence doesn't reliably accept .docx via binary buffer upload.
function isDocxDocument(options = {}) {
  const contentType = normalizeContentType(options);
  return contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function isLegacyDocFile(options = {}) {
  const fileName = String(options.fileName || "").toLowerCase();
  return fileName.endsWith(".doc") && !fileName.endsWith(".docx");
}

function looksLikeWordFile(options = {}) {
  if (isWordDocument(options)) {
    return true;
  }

  const fileName = String(options.fileName || "").toLowerCase();
  return fileName.endsWith(".doc") || fileName.endsWith(".docx");
}

function isAzureInvalidRequest(error) {
  const message = String(error && error.message ? error.message : "").toLowerCase();
  return message.includes("invalid request");
}

function normalizeContentType(options = {}) {
  const explicit = String(options.contentType || "").trim().toLowerCase();
  if (explicit && explicit !== "application/octet-stream") {
    return explicit;
  }

  const fileName = String(options.fileName || "").toLowerCase();
  if (fileName.endsWith(".pdf")) return "application/pdf";
  if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) return "image/jpeg";
  if (fileName.endsWith(".png")) return "image/png";
  if (fileName.endsWith(".tif") || fileName.endsWith(".tiff")) return "image/tiff";
  if (fileName.endsWith(".bmp")) return "image/bmp";
  if (fileName.endsWith(".heif") || fileName.endsWith(".heic")) return "image/heif";
  if (fileName.endsWith(".doc")) return "application/msword";
  if (fileName.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (fileName.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (fileName.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (fileName.endsWith(".html") || fileName.endsWith(".htm")) return "text/html";

  return "application/octet-stream";
}

module.exports = {
  analyzeDocumentBuffer,
  findEvidenceLocation,
};
