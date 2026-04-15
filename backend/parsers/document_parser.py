"""
Unified document parser dispatcher.

Given a file path, detects the document type and delegates to the
appropriate sub-parser (PDF, Word, image).
"""
from pathlib import Path

from backend.models import DocumentType


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".gif", ".webp"}
WORD_EXTENSIONS = {".docx", ".doc"}
PDF_EXTENSIONS = {".pdf"}
TEXT_EXTENSIONS = {".txt", ".text"}


def detect_document_type(file_path: str) -> DocumentType:
    """Infer the document type from the file extension."""
    suffix = Path(file_path).suffix.lower()
    if suffix in PDF_EXTENSIONS:
        return DocumentType.PDF
    if suffix in WORD_EXTENSIONS:
        return DocumentType.WORD
    if suffix in IMAGE_EXTENSIONS:
        return DocumentType.IMAGE
    if suffix in TEXT_EXTENSIONS:
        return DocumentType.TEXT
    return DocumentType.UNKNOWN


def parse_document(file_path: str) -> dict:
    """
    Parse any supported document and return a unified result dict.

    The returned dict always contains:
        - text (str): full extracted text
        - doc_type (str): detected document type
        - pages (list): per-page text (PDF only, otherwise single-item list)
        - is_scanned (bool): True if OCR was used
        - confidence_hint (float): 0–1 OCR confidence (0 for native text docs)
        - metadata (dict): title, author, etc. where available
        - error (str|None): error message if parsing failed
    """
    doc_type = detect_document_type(file_path)

    if doc_type == DocumentType.PDF:
        from backend.parsers.pdf_parser import parse_pdf
        result = parse_pdf(file_path)
        result["doc_type"] = DocumentType.PDF.value
        result.setdefault("confidence_hint", 0.95 if not result.get("is_scanned") else 0.70)

    elif doc_type == DocumentType.WORD:
        from backend.parsers.word_parser import parse_word
        result = parse_word(file_path)
        result["doc_type"] = DocumentType.WORD.value
        result["is_scanned"] = False
        result["pages"] = [{"page": 1, "text": result.get("text", ""), "is_ocr": False}]
        result["confidence_hint"] = 0.95

    elif doc_type == DocumentType.IMAGE:
        from backend.parsers.image_parser import parse_image
        result = parse_image(file_path)
        result["doc_type"] = DocumentType.IMAGE.value
        result["is_scanned"] = True
        result["pages"] = [{"page": 1, "text": result.get("text", ""), "is_ocr": True}]
        result["metadata"] = {}

    elif doc_type == DocumentType.TEXT:
        try:
            with open(file_path, encoding="utf-8", errors="replace") as f:
                text = f.read()
        except Exception as exc:
            text = ""
            result = {
                "text": text,
                "doc_type": DocumentType.TEXT.value,
                "is_scanned": False,
                "pages": [{"page": 1, "text": text, "is_ocr": False}],
                "confidence_hint": 0.95,
                "metadata": {},
                "error": str(exc),
            }
            return result

        result = {
            "text": text,
            "doc_type": DocumentType.TEXT.value,
            "is_scanned": False,
            "pages": [{"page": 1, "text": text, "is_ocr": False}],
            "confidence_hint": 0.95,
            "metadata": {},
            "error": None,
        }

    else:
        result = {
            "text": "",
            "doc_type": DocumentType.UNKNOWN.value,
            "is_scanned": False,
            "pages": [],
            "confidence_hint": 0.0,
            "metadata": {},
            "error": f"Unsupported document type for file: {file_path}",
        }

    return result
