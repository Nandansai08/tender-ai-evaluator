const {
  AzureKeyCredential,
  DocumentAnalysisClient,
} = require("@azure/ai-form-recognizer");

function createDocumentClient() {
  const endpoint = process.env.DOCUMENT_INTELLIGENCE_ENDPOINT;
  const key = process.env.DOCUMENT_INTELLIGENCE_KEY;

  if (!endpoint || !key) {
    throw new Error("Document Intelligence endpoint or key is not configured.");
  }

  return new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));
}

async function analyzeDocumentBuffer(buffer) {
  const client = createDocumentClient();
  const poller = await client.beginAnalyzeDocument("prebuilt-layout", buffer);
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
}

module.exports = {
  analyzeDocumentBuffer,
};
