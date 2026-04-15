"""PDF document parser using PyMuPDF."""
import io
from pathlib import Path


def parse_pdf(file_path: str) -> dict:
    """
    Parse a PDF file and extract text content.

    Handles both digital (text-based) and scanned (image-based) PDFs.
    For scanned pages, OCR is applied via the image parser.

    Returns:
        dict with keys: text, pages, is_scanned, metadata
    """
    try:
        import fitz  # PyMuPDF
    except ImportError:
        return _fallback_pdf_parse(file_path)

    from backend.parsers.image_parser import ocr_image_bytes

    pages = []
    full_text_parts = []
    is_scanned = False
    metadata = {}

    try:
        doc = fitz.open(file_path)
        metadata = {
            "title": doc.metadata.get("title", ""),
            "author": doc.metadata.get("author", ""),
            "page_count": len(doc),
        }

        for page_num, page in enumerate(doc, start=1):
            page_text = page.get_text("text").strip()

            used_ocr = False
            if not page_text:
                # Scanned page — render to image and OCR
                is_scanned = True
                used_ocr = True
                pix = page.get_pixmap(dpi=200)
                img_bytes = pix.tobytes("png")
                page_text = ocr_image_bytes(img_bytes) or ""

            pages.append({"page": page_num, "text": page_text, "is_ocr": used_ocr})
            full_text_parts.append(page_text)

        doc.close()
    except Exception as exc:
        return {
            "text": "",
            "pages": [],
            "is_scanned": False,
            "metadata": {},
            "error": str(exc),
        }

    full_text = "\n\n".join(full_text_parts)
    return {
        "text": full_text,
        "pages": pages,
        "is_scanned": is_scanned,
        "metadata": metadata,
        "error": None,
    }


def _fallback_pdf_parse(file_path: str) -> dict:
    """Fallback when PyMuPDF is not installed — return an error dict."""
    return {
        "text": "",
        "pages": [],
        "is_scanned": False,
        "metadata": {},
        "error": "PyMuPDF (fitz) is not installed. Install it with: pip install PyMuPDF",
    }
