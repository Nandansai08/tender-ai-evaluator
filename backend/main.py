"""
Tender AI Evaluator — FastAPI backend entry point.

Routes:
  POST /api/tender/upload           Upload & parse a tender document → extract criteria
  GET  /api/tender/{tender_id}      Get tender + criteria
  POST /api/bidder/upload           Upload bidder documents (multipart, include tender_id + bidder_name)
  GET  /api/bidder/{bidder_id}      Get bidder info + evidence
  POST /api/evaluate                Run evaluation for a tender + set of bidders
  GET  /api/report/{report_id}      Get evaluation report (JSON)
  GET  /api/report/{report_id}/pdf  Download PDF report
  GET  /api/audit                   List audit log entries
  GET  /                            Serve the frontend HTML
"""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from datetime import datetime
from typing import Optional

from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database import (
    AuditRecord,
    BidderRecord,
    EvaluationRecord,
    TenderRecord,
    get_db,
    init_db,
    write_audit,
)
from backend.models import (
    BidderEvaluation,
    BidderUploadResponse,
    Criterion,
    CriteriaExtractionResult,
    DocumentType,
    EvaluationReport,
    EvaluationRequest,
    EvaluationResponse,
    TenderUploadResponse,
    Verdict,
)
from backend.parsers import parse_document
from backend.ai import extract_criteria, extract_evidence, evaluate_bidder
from backend.reports import generate_pdf_report, generate_json_report

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


# ─── App setup ────────────────────────────────────────────────────────────────

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="AI-based tender evaluation and eligibility analysis for government procurement.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
UPLOAD_DIR = Path(settings.upload_dir)
REPORTS_DIR = Path(settings.reports_dir)

UPLOAD_DIR.mkdir(exist_ok=True)
REPORTS_DIR.mkdir(exist_ok=True)



# ─── Static files + frontend ──────────────────────────────────────────────────

if (FRONTEND_DIR / "css").exists():
    app.mount("/css", StaticFiles(directory=str(FRONTEND_DIR / "css")), name="css")

if (FRONTEND_DIR / "js").exists():
    app.mount("/js", StaticFiles(directory=str(FRONTEND_DIR / "js")), name="js")


@app.get("/", response_class=HTMLResponse)
async def serve_frontend():
    html_path = FRONTEND_DIR / "index.html"
    if html_path.exists():
        return HTMLResponse(content=html_path.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>Tender AI Evaluator API</h1><p>See /docs for API documentation.</p>")


# ─── Health check ─────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "app": settings.app_name,
        "version": settings.app_version,
        "ai_mode": "mock" if settings.use_mock_ai else "openai",
    }


# ─── Tender endpoints ─────────────────────────────────────────────────────────

@app.post("/api/tender/upload", response_model=TenderUploadResponse)
async def upload_tender(
    file: UploadFile = File(...),
    tender_name: str = Form(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload a tender document (PDF, Word, image, or text).
    The system parses it, extracts eligibility criteria, and stores them.
    """
    tender_id = str(uuid.uuid4())
    safe_name = Path(file.filename).name if file.filename else "tender"
    file_path = UPLOAD_DIR / f"tender_{tender_id}_{safe_name}"

    # Save uploaded file
    content = await file.read()
    if len(content) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large.")
    file_path.write_bytes(content)

    # Parse document
    parsed = parse_document(str(file_path))
    doc_text = parsed.get("text", "")

    if parsed.get("error") and not doc_text:
        raise HTTPException(status_code=422, detail=f"Could not parse document: {parsed['error']}")

    # Extract criteria
    result: CriteriaExtractionResult = extract_criteria(doc_text, tender_id, tender_name)

    # Persist
    record = TenderRecord(
        id=tender_id,
        name=tender_name,
        file_path=str(file_path),
        criteria_json=json.dumps([c.model_dump() for c in result.criteria], default=str),
        extraction_confidence=result.extraction_confidence,
    )
    db.add(record)
    await db.commit()

    await write_audit(db, "tender_uploaded", tender_id, "tender", {
        "name": tender_name,
        "file": safe_name,
        "criteria_count": len(result.criteria),
        "confidence": result.extraction_confidence,
    })

    return TenderUploadResponse(
        tender_id=tender_id,
        message=f"Tender uploaded and {len(result.criteria)} criteria extracted.",
        criteria_count=len(result.criteria),
        criteria=result.criteria,
        extraction_confidence=result.extraction_confidence,
    )


@app.get("/api/tender/{tender_id}")
async def get_tender(tender_id: str, db: AsyncSession = Depends(get_db)):
    record = await db.get(TenderRecord, tender_id)
    if not record:
        raise HTTPException(status_code=404, detail="Tender not found.")
    criteria = [Criterion(**c) for c in json.loads(record.criteria_json)]
    return {
        "tender_id": record.id,
        "name": record.name,
        "criteria": criteria,
        "extraction_confidence": record.extraction_confidence,
        "created_at": record.created_at,
    }


@app.get("/api/tenders")
async def list_tenders(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TenderRecord).order_by(TenderRecord.created_at.desc()))
    records = result.scalars().all()
    return [
        {
            "tender_id": r.id,
            "name": r.name,
            "criteria_count": len(json.loads(r.criteria_json)),
            "created_at": r.created_at,
        }
        for r in records
    ]


# ─── Bidder endpoints ─────────────────────────────────────────────────────────

@app.post("/api/bidder/upload", response_model=BidderUploadResponse)
async def upload_bidder(
    tender_id: str = Form(...),
    bidder_name: str = Form(...),
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload one or more bidder submission documents.
    Evidence is extracted for each criterion from the tender.
    """
    # Validate tender exists
    tender_record = await db.get(TenderRecord, tender_id)
    if not tender_record:
        raise HTTPException(status_code=404, detail="Tender not found.")
    criteria = [Criterion(**c) for c in json.loads(tender_record.criteria_json)]

    bidder_id = str(uuid.uuid4())
    bidder_dir = UPLOAD_DIR / f"bidder_{bidder_id}"
    bidder_dir.mkdir(exist_ok=True)

    saved_paths: list[str] = []
    evidence_map: dict[str, list] = {}

    for f in files:
        safe_name = Path(f.filename).name if f.filename else f"document_{len(saved_paths)}"
        dest = bidder_dir / safe_name
        content = await f.read()
        if len(content) > settings.max_upload_size_mb * 1024 * 1024:
            continue
        dest.write_bytes(content)
        saved_paths.append(str(dest))

        parsed = parse_document(str(dest))
        doc_text = parsed.get("text", "")
        doc_type_str = parsed.get("doc_type", DocumentType.UNKNOWN.value)
        doc_type = DocumentType(doc_type_str)
        conf_hint = parsed.get("confidence_hint", 0.80)

        evidences = extract_evidence(doc_text, safe_name, doc_type, criteria, conf_hint)
        for ev in evidences:
            evidence_map.setdefault(ev.criterion_id, []).append(ev.model_dump())

    # Persist
    record = BidderRecord(
        id=bidder_id,
        tender_id=tender_id,
        name=bidder_name,
        documents_json=json.dumps(saved_paths),
        evidence_json=json.dumps(evidence_map),
    )
    db.add(record)
    await db.commit()

    await write_audit(db, "bidder_uploaded", bidder_id, "bidder", {
        "tender_id": tender_id,
        "name": bidder_name,
        "documents": len(saved_paths),
    })

    return BidderUploadResponse(
        bidder_id=bidder_id,
        bidder_name=bidder_name,
        message=f"Bidder uploaded with {len(saved_paths)} document(s) parsed.",
        documents_parsed=len(saved_paths),
    )


@app.get("/api/bidders/{tender_id}")
async def list_bidders(tender_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(BidderRecord)
        .where(BidderRecord.tender_id == tender_id)
        .order_by(BidderRecord.created_at.desc())
    )
    records = result.scalars().all()
    return [
        {
            "bidder_id": r.id,
            "name": r.name,
            "documents": json.loads(r.documents_json),
            "created_at": r.created_at,
        }
        for r in records
    ]


@app.get("/api/bidder/{bidder_id}")
async def get_bidder(bidder_id: str, db: AsyncSession = Depends(get_db)):
    record = await db.get(BidderRecord, bidder_id)
    if not record:
        raise HTTPException(status_code=404, detail="Bidder not found.")
    return {
        "bidder_id": record.id,
        "tender_id": record.tender_id,
        "name": record.name,
        "documents": json.loads(record.documents_json),
        "evidence_map": json.loads(record.evidence_json),
        "created_at": record.created_at,
    }


# ─── Evaluation endpoints ─────────────────────────────────────────────────────

@app.post("/api/evaluate", response_model=EvaluationResponse)
async def run_evaluation(
    request: EvaluationRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Evaluate all (or specified) bidders against the tender's criteria.
    Produces a full evaluation report with criterion-level verdicts.
    """
    tender_record = await db.get(TenderRecord, request.tender_id)
    if not tender_record:
        raise HTTPException(status_code=404, detail="Tender not found.")

    criteria = [Criterion(**c) for c in json.loads(tender_record.criteria_json)]

    # Resolve bidder IDs
    if request.bidder_ids:
        bidder_records = []
        for bid in request.bidder_ids:
            r = await db.get(BidderRecord, bid)
            if r and r.tender_id == request.tender_id:
                bidder_records.append(r)
    else:
        res = await db.execute(
            select(BidderRecord).where(BidderRecord.tender_id == request.tender_id)
        )
        bidder_records = res.scalars().all()

    if not bidder_records:
        raise HTTPException(status_code=404, detail="No bidders found for this tender.")

    # Evaluate each bidder
    bidder_evaluations: list[BidderEvaluation] = []
    for br in bidder_records:
        raw_evidence = json.loads(br.evidence_json)
        from backend.models import Evidence
        evidence_map = {
            cid: [Evidence(**e) for e in evs]
            for cid, evs in raw_evidence.items()
        }
        beval = evaluate_bidder(br.id, br.name, criteria, evidence_map)
        bidder_evaluations.append(beval)

    # Build report
    report_id = str(uuid.uuid4())
    eligible = sum(1 for b in bidder_evaluations if b.overall_verdict == Verdict.ELIGIBLE)
    not_eligible = sum(1 for b in bidder_evaluations if b.overall_verdict == Verdict.NOT_ELIGIBLE)
    review = sum(1 for b in bidder_evaluations if b.overall_verdict == Verdict.NEEDS_REVIEW)

    report = EvaluationReport(
        report_id=report_id,
        tender_id=request.tender_id,
        tender_name=tender_record.name,
        criteria=criteria,
        bidder_evaluations=bidder_evaluations,
        summary={
            "total": len(bidder_evaluations),
            "eligible": eligible,
            "not_eligible": not_eligible,
            "needs_review": review,
        },
    )

    # Generate PDF + JSON reports
    pdf_path = generate_pdf_report(report, str(REPORTS_DIR))
    json_path = generate_json_report(report, str(REPORTS_DIR))

    # Persist evaluation
    eval_record = EvaluationRecord(
        id=report_id,
        tender_id=request.tender_id,
        report_json=json_path,
        report_path=pdf_path,
    )
    db.add(eval_record)
    await db.commit()

    await write_audit(db, "evaluation_completed", report_id, "evaluation", {
        "tender_id": request.tender_id,
        "total_bidders": len(bidder_evaluations),
        "eligible": eligible,
        "not_eligible": not_eligible,
        "needs_review": review,
    })

    return EvaluationResponse(
        report_id=report_id,
        message="Evaluation completed successfully.",
        total_bidders=len(bidder_evaluations),
        eligible_count=eligible,
        not_eligible_count=not_eligible,
        review_count=review,
    )


@app.get("/api/report/{report_id}")
async def get_report(report_id: str, db: AsyncSession = Depends(get_db)):
    record = await db.get(EvaluationRecord, report_id)
    if not record:
        raise HTTPException(status_code=404, detail="Report not found.")
    json_path = record.report_json
    if not json_path or not Path(json_path).exists():
        raise HTTPException(status_code=404, detail="Report file not found.")
    with open(json_path, encoding="utf-8") as f:
        return json.load(f)


@app.get("/api/report/{report_id}/pdf")
async def download_report_pdf(report_id: str, db: AsyncSession = Depends(get_db)):
    record = await db.get(EvaluationRecord, report_id)
    if not record or not record.report_path:
        raise HTTPException(status_code=404, detail="PDF report not found.")
    pdf_path = Path(record.report_path)
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF file not found on disk.")
    return FileResponse(
        path=str(pdf_path),
        media_type="application/pdf",
        filename=f"evaluation_report_{report_id[:8]}.pdf",
    )


@app.get("/api/reports")
async def list_reports(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(EvaluationRecord).order_by(EvaluationRecord.created_at.desc()))
    records = result.scalars().all()
    return [
        {"report_id": r.id, "tender_id": r.tender_id, "created_at": r.created_at}
        for r in records
    ]


# ─── Audit endpoints ──────────────────────────────────────────────────────────

@app.get("/api/audit")
async def get_audit_log(
    limit: int = 100,
    entity_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(AuditRecord).order_by(AuditRecord.timestamp.desc()).limit(limit)
    if entity_type:
        query = query.where(AuditRecord.entity_type == entity_type)
    result = await db.execute(query)
    records = result.scalars().all()
    return [
        {
            "audit_id": r.audit_id,
            "event_type": r.event_type,
            "entity_id": r.entity_id,
            "entity_type": r.entity_type,
            "details": json.loads(r.details_json),
            "actor": r.actor,
            "timestamp": r.timestamp,
        }
        for r in records
    ]
