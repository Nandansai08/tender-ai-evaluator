"""Tests for the AI criteria extractor."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.ai.criteria_extractor import extract_criteria, _mock_extract, _default_criteria
from backend.models import Criterion, CriterionType, CriterionMandatory, CriteriaExtractionResult

SAMPLE_TENDER_TEXT = """
ELIGIBILITY CRITERIA

3.1 Financial Eligibility
The bidder must have an average annual turnover of not less than ₹5 Crore from construction works
during the last 3 financial years.

3.2 Similar Work Experience
The bidder must have successfully completed at least 3 similar projects of civil construction
in the last 5 years.

3.3 GST Registration
The bidder must possess a valid GST registration certificate.

3.4 ISO 9001 Certification
Bidders must hold a valid ISO 9001:2015 Quality Management System certification.

3.5 PAN Card
A valid PAN card is required.
"""


class TestCriteriaExtractor:
    def test_returns_criteria_extraction_result(self):
        result = extract_criteria(SAMPLE_TENDER_TEXT, "t001", "Test Tender")
        assert isinstance(result, CriteriaExtractionResult)
        assert result.tender_id == "t001"
        assert result.tender_name == "Test Tender"

    def test_extracts_criteria_list(self):
        result = extract_criteria(SAMPLE_TENDER_TEXT, "t001", "Test Tender")
        assert len(result.criteria) > 0

    def test_each_criterion_has_required_fields(self):
        result = extract_criteria(SAMPLE_TENDER_TEXT, "t001", "Test Tender")
        for c in result.criteria:
            assert isinstance(c, Criterion)
            assert c.criterion_id
            assert c.name
            assert c.description
            assert isinstance(c.criterion_type, CriterionType)
            assert isinstance(c.mandatory, CriterionMandatory)

    def test_detects_financial_criterion(self):
        result = extract_criteria(SAMPLE_TENDER_TEXT, "t001", "Test Tender")
        types = [c.criterion_type for c in result.criteria]
        assert CriterionType.FINANCIAL in types

    def test_detects_gst_compliance(self):
        result = extract_criteria(SAMPLE_TENDER_TEXT, "t001", "Test Tender")
        found_gst = any("gst" in c.name.lower() for c in result.criteria)
        assert found_gst, "Should detect GST registration criterion"

    def test_detects_iso_certification(self):
        result = extract_criteria(SAMPLE_TENDER_TEXT, "t001", "Test Tender")
        found_iso = any("iso" in c.name.lower() or c.criterion_type == CriterionType.CERTIFICATION
                        for c in result.criteria)
        assert found_iso, "Should detect ISO certification criterion"

    def test_confidence_is_between_0_and_1(self):
        result = extract_criteria(SAMPLE_TENDER_TEXT, "t001", "Test Tender")
        assert 0.0 <= result.extraction_confidence <= 1.0

    def test_empty_text_returns_default_criteria(self):
        result = extract_criteria("", "t002", "Empty Tender")
        assert len(result.criteria) > 0  # Should always return something

    def test_default_criteria_have_valid_structure(self):
        defaults = _default_criteria("Test")
        assert len(defaults) > 0
        for c in defaults:
            assert c.criterion_id
            assert c.name
            assert isinstance(c.criterion_type, CriterionType)

    def test_criterion_ids_are_unique(self):
        result = extract_criteria(SAMPLE_TENDER_TEXT, "t001", "Test Tender")
        ids = [c.criterion_id for c in result.criteria]
        assert len(ids) == len(set(ids)), "Criterion IDs must be unique"
