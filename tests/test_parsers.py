"""Tests for the document parsers."""
import os
import sys
import tempfile

import pytest

# Ensure the project root is on the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.parsers.document_parser import detect_document_type, parse_document
from backend.models import DocumentType


class TestDetectDocumentType:
    def test_pdf(self):
        assert detect_document_type("tender.pdf") == DocumentType.PDF

    def test_docx(self):
        assert detect_document_type("bid.docx") == DocumentType.WORD

    def test_doc(self):
        assert detect_document_type("bid.doc") == DocumentType.WORD

    def test_image_jpg(self):
        assert detect_document_type("scan.jpg") == DocumentType.IMAGE

    def test_image_png(self):
        assert detect_document_type("photo.PNG") == DocumentType.IMAGE

    def test_image_tiff(self):
        assert detect_document_type("cert.tiff") == DocumentType.IMAGE

    def test_text(self):
        assert detect_document_type("document.txt") == DocumentType.TEXT

    def test_unknown(self):
        assert detect_document_type("file.xyz") == DocumentType.UNKNOWN

    def test_case_insensitive(self):
        assert detect_document_type("TENDER.PDF") == DocumentType.PDF


class TestParseDocument:
    def test_parse_text_file(self, tmp_path):
        """Plain text files should be parsed without error."""
        content = "This is a test document.\nTurnover: ₹8 Crore\nGST Registration: 07AABCA1234B1Z5"
        txt_file = tmp_path / "test.txt"
        txt_file.write_text(content, encoding="utf-8")

        result = parse_document(str(txt_file))

        assert result["doc_type"] == DocumentType.TEXT.value
        assert result["error"] is None
        assert "turnover" in result["text"].lower()
        assert result["is_scanned"] is False
        assert result["confidence_hint"] > 0

    def test_parse_text_file_returns_pages(self, tmp_path):
        """Text files should produce a single page entry."""
        txt_file = tmp_path / "test.txt"
        txt_file.write_text("Hello world", encoding="utf-8")
        result = parse_document(str(txt_file))
        assert len(result["pages"]) == 1
        assert result["pages"][0]["page"] == 1

    def test_parse_unknown_type(self, tmp_path):
        """Unknown file types should return an error entry."""
        unknown_file = tmp_path / "data.xyz"
        unknown_file.write_bytes(b"binary data")
        result = parse_document(str(unknown_file))
        assert result["doc_type"] == DocumentType.UNKNOWN.value
        assert result["error"] is not None
        assert result["text"] == ""
