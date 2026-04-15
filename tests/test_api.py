"""Integration tests for the FastAPI backend endpoints."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Must be set before app import (also set in conftest.py, this is a safety net)
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite://")

from httpx import AsyncClient, ASGITransport
from backend.main import app


class TestHealthEndpoint:
    async def test_health_ok(self, client):
        resp = await client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "ai_mode" in data


class TestTenderUpload:
    async def test_upload_text_tender(self, client):
        content = b"""
        ELIGIBILITY CRITERIA
        Minimum annual turnover of Rs. 5 crore.
        GST registration required.
        At least 3 similar projects completed.
        ISO 9001 certification mandatory.
        """
        resp = await client.post(
            "/api/tender/upload",
            data={"tender_name": "Test Tender"},
            files={"file": ("tender.txt", content, "text/plain")},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "tender_id" in data
        assert data["criteria_count"] > 0
        assert "criteria" in data

    async def test_upload_returns_criteria(self, client):
        content = b"Turnover of Rs 5 crore required. GST registration needed."
        resp = await client.post(
            "/api/tender/upload",
            data={"tender_name": "Criteria Test"},
            files={"file": ("t.txt", content, "text/plain")},
        )
        assert resp.status_code == 200
        data = resp.json()
        for c in data["criteria"]:
            assert "criterion_id" in c
            assert "name" in c
            assert "criterion_type" in c

    async def test_list_tenders(self, client):
        resp = await client.get("/api/tenders")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


class TestBidderUpload:
    async def _upload_tender(self, client):
        content = b"Annual turnover Rs 5 crore. GST required. ISO 9001 mandatory."
        resp = await client.post(
            "/api/tender/upload",
            data={"tender_name": "Bidder Test Tender"},
            files={"file": ("t.txt", content, "text/plain")},
        )
        return resp.json()["tender_id"]

    async def test_upload_bidder_documents(self, client):
        tender_id = await self._upload_tender(client)
        bidder_content = b"Annual turnover: Rs 8 crore. GSTIN: 07AABCA1234B1Z5. ISO 9001 certified."
        resp = await client.post(
            "/api/bidder/upload",
            data={"tender_id": tender_id, "bidder_name": "Test Bidder Co."},
            files=[("files", ("bid.txt", bidder_content, "text/plain"))],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "bidder_id" in data
        assert data["documents_parsed"] == 1

    async def test_upload_bidder_invalid_tender(self, client):
        bidder_content = b"Some bidder content"
        resp = await client.post(
            "/api/bidder/upload",
            data={"tender_id": "nonexistent-id", "bidder_name": "Ghost Bidder"},
            files=[("files", ("bid.txt", bidder_content, "text/plain"))],
        )
        assert resp.status_code == 404


class TestEvaluation:
    async def _setup_tender_and_bidder(self, client):
        """Helper to create a tender and bidder, returning their IDs."""
        t_content = b"Annual turnover Rs 5 crore. GST required."
        t_resp = await client.post(
            "/api/tender/upload",
            data={"tender_name": "Eval Test Tender"},
            files={"file": ("t.txt", t_content, "text/plain")},
        )
        tender_id = t_resp.json()["tender_id"]

        b_content = b"Our annual turnover is Rs 8 crore. GSTIN: 07AABCA1234B1Z5."
        await client.post(
            "/api/bidder/upload",
            data={"tender_id": tender_id, "bidder_name": "Evaluation Bidder"},
            files=[("files", ("bid.txt", b_content, "text/plain"))],
        )
        return tender_id

    async def test_run_evaluation(self, client):
        tender_id = await self._setup_tender_and_bidder(client)
        resp = await client.post(
            "/api/evaluate",
            json={"tender_id": tender_id, "bidder_ids": []},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "report_id" in data
        assert data["total_bidders"] >= 1

    async def test_get_report(self, client):
        tender_id = await self._setup_tender_and_bidder(client)
        eval_resp = await client.post(
            "/api/evaluate",
            json={"tender_id": tender_id, "bidder_ids": []},
        )
        report_id = eval_resp.json()["report_id"]
        resp = await client.get(f"/api/report/{report_id}")
        assert resp.status_code == 200
        report = resp.json()
        assert "bidder_evaluations" in report
        assert "criteria" in report

    async def test_report_has_criterion_level_verdicts(self, client):
        tender_id = await self._setup_tender_and_bidder(client)
        eval_resp = await client.post(
            "/api/evaluate",
            json={"tender_id": tender_id, "bidder_ids": []},
        )
        report_id = eval_resp.json()["report_id"]
        report = (await client.get(f"/api/report/{report_id}")).json()

        for beval in report["bidder_evaluations"]:
            assert "criterion_evaluations" in beval
            for ce in beval["criterion_evaluations"]:
                assert "verdict" in ce
                assert "explanation" in ce
                assert ce["explanation"]  # Must be non-empty

    async def test_evaluate_nonexistent_tender(self, client):
        resp = await client.post(
            "/api/evaluate",
            json={"tender_id": "does-not-exist", "bidder_ids": []},
        )
        assert resp.status_code == 404


class TestAuditLog:
    async def test_audit_log_is_accessible(self, client):
        resp = await client.get("/api/audit")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    async def test_audit_entries_have_required_fields(self, client):
        resp = await client.get("/api/audit")
        entries = resp.json()
        for entry in entries[:5]:
            assert "event_type" in entry
            assert "entity_type" in entry
            assert "entity_id" in entry
            assert "timestamp" in entry

