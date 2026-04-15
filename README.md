# Tender AI Evaluator

**AI-Based Tender Evaluation and Eligibility Analysis for Government Procurement by CRPF**

---

## Overview

The Tender AI Evaluator is a full-stack platform that automates the evaluation of bidder eligibility for government procurement tenders. Given a tender document and a set of bidder submissions, the system:

1. **Extracts eligibility criteria** from the tender document (financial, technical, compliance, certification, experience)
2. **Parses bidder documents** in any format — typed PDFs, scanned copies, Word files, photographs
3. **Evaluates each bidder** criterion-by-criterion with explainable verdicts: `Eligible`, `Not Eligible`, or `Needs Manual Review`
4. **Generates audit-ready reports** (PDF + JSON) suitable for formal government procurement decisions

### Key Design Principles

- **Explainability first**: Every verdict references the specific criterion, document, and extracted value
- **Never silently disqualify**: Ambiguous or low-confidence cases are always flagged for human review
- **Audit trail**: All actions are logged to a tamper-evident audit database
- **Document diversity**: Handles typed PDFs, scanned documents, Word files, images with OCR
- **Dual-mode AI**: Uses OpenAI GPT-4o when an API key is available; falls back to a robust rule-based engine for testing and demonstration

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (HTML/JS)                      │
│  Upload Tender → Upload Bidders → Run Evaluation → Reports  │
└───────────────────────┬─────────────────────────────────────┘
                        │ REST API
┌───────────────────────▼─────────────────────────────────────┐
│                   FastAPI Backend                             │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │  Parsers    │  │  AI Engine   │  │  Report Generator  │  │
│  │             │  │              │  │                    │  │
│  │ • PDF       │  │ • Criteria   │  │ • PDF (ReportLab)  │  │
│  │ • Word      │  │   Extractor  │  │ • JSON             │  │
│  │ • Image/OCR │  │ • Evidence   │  │                    │  │
│  │ • Text      │  │   Extractor  │  └────────────────────┘  │
│  └─────────────┘  │ • Evaluator  │  ┌────────────────────┐  │
│                   └──────────────┘  │  Audit Trail       │  │
│                                     │  (SQLite)          │  │
│                   ┌──────────────┐  └────────────────────┘  │
│                   │  AI Backend  │                           │
│                   │ OpenAI GPT-4o│                           │
│                   │ (or mock)    │                           │
│                   └──────────────┘                           │
└─────────────────────────────────────────────────────────────┘
```

### Technology Choices

| Component | Technology | Reason |
|-----------|-----------|--------|
| API Framework | FastAPI | Async, fast, automatic OpenAPI docs |
| AI/LLM | OpenAI GPT-4o | Best-in-class structured extraction; graceful mock fallback |
| PDF Parsing | PyMuPDF | High fidelity; handles scanned + text PDFs |
| Word Parsing | python-docx | Native .docx structure extraction |
| OCR | Tesseract + Pillow | Open-source, multi-language, high accuracy |
| Database | SQLite + SQLAlchemy | Zero-config, audit-ready, portable |
| Report PDF | ReportLab | Fully custom, government-grade formatting |
| Frontend | Vanilla HTML/JS | Zero build dependencies, instant load |

---

## Project Structure

```
tender-ai-evaluator/
├── backend/
│   ├── main.py              # FastAPI application and routes
│   ├── config.py            # Settings (from env / .env file)
│   ├── models.py            # Pydantic data models
│   ├── database.py          # SQLAlchemy ORM + audit trail
│   ├── parsers/
│   │   ├── document_parser.py   # Dispatcher — detect and route file types
│   │   ├── pdf_parser.py        # PyMuPDF-based PDF parser (+ OCR fallback)
│   │   ├── word_parser.py       # python-docx Word document parser
│   │   └── image_parser.py      # Tesseract OCR image parser
│   ├── ai/
│   │   ├── criteria_extractor.py  # Extract eligibility criteria from tender
│   │   ├── evidence_extractor.py  # Extract evidence from bidder documents
│   │   └── evaluator.py           # Eligibility evaluation engine
│   └── reports/
│       └── report_generator.py    # PDF + JSON report generation
├── frontend/
│   ├── index.html           # Single-page application
│   ├── css/style.css
│   └── js/app.js
├── sample_data/
│   ├── sample_tender.txt           # Representative CRPF construction tender
│   ├── bidder_abc_construction.txt # Eligible bidder example
│   ├── bidder_xyz_builders.txt     # Ineligible bidder example
│   └── bidder_sunrise_infra.txt    # Borderline bidder example
├── tests/
│   ├── conftest.py                  # Pytest fixtures
│   ├── test_parsers.py              # Document parser unit tests
│   ├── test_criteria_extractor.py   # Criteria extractor unit tests
│   ├── test_evidence_extractor.py   # Evidence extractor unit tests
│   ├── test_evaluator.py            # Evaluation engine unit tests
│   └── test_api.py                  # FastAPI integration tests
├── requirements.txt
├── run.py                   # Application entry point
└── pytest.ini
```

---

## Setup and Installation

### Prerequisites

- Python 3.10+
- Tesseract OCR (for scanned document support)

#### Install Tesseract

```bash
# Ubuntu / Debian
sudo apt-get install tesseract-ocr

# macOS
brew install tesseract

# Windows
# Download installer from: https://github.com/UB-Mannheim/tesseract/wiki
```

### Installation

```bash
# Clone the repository
git clone https://github.com/Nandansai08/tender-ai-evaluator.git
cd tender-ai-evaluator

# Create a virtual environment
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### Configuration

Create a `.env` file in the project root:

```env
# Optional — if not set, mock AI is used (no API key required)
OPENAI_API_KEY=sk-...

# Set to "false" to enable real OpenAI calls when key is present
USE_MOCK_AI=true

# Other settings (defaults shown)
DATABASE_URL=sqlite+aiosqlite:///./tender_evaluator.db
UPLOAD_DIR=uploads
REPORTS_DIR=reports_output
```

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | _(empty)_ | OpenAI API key. If empty, mock AI is used |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI model to use |
| `USE_MOCK_AI` | `true` | Force mock AI even if API key is set |
| `DATABASE_URL` | `sqlite+aiosqlite:///./tender_evaluator.db` | Database connection |
| `UPLOAD_DIR` | `uploads` | Directory for uploaded files |
| `REPORTS_DIR` | `reports_output` | Directory for generated reports |

### Running the Server

```bash
python run.py
# or
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Open your browser at **http://localhost:8000**

The interactive API documentation is available at **http://localhost:8000/docs**

---

## Usage

### Via the Web Interface

1. **Upload Tender** (Step 1): Enter the tender name and upload the tender document. The system automatically extracts and displays all eligibility criteria.

2. **Upload Bidders** (Step 2): For each bidder, enter the company name and upload their submission documents (multiple files supported per bidder).

3. **Evaluate** (Evaluate tab): Select the tender and click "Run Evaluation". The system produces a full criterion-by-criterion report for all bidders.

4. **View Report** (Reports tab): Download the PDF report or view the JSON data. The PDF is formatted for procurement officer sign-off.

5. **Audit Log** (Audit Log tab): View the complete audit trail of all system actions.

### Quick Demo with Sample Data

```bash
python -c "
import asyncio
from httpx import AsyncClient, ASGITransport
import os; os.environ['DATABASE_URL'] = 'sqlite+aiosqlite:///'
from backend.database import init_db
from backend.main import app

async def demo():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        with open('sample_data/sample_tender.txt', 'rb') as f:
            resp = await client.post('/api/tender/upload',
                data={'tender_name': 'CRPF Demo Tender'},
                files={'file': ('tender.txt', f, 'text/plain')})
        print(f'Extracted {resp.json()[\"criteria_count\"]} criteria')

asyncio.run(demo())
"
```

### Via the REST API

```bash
# 1. Upload tender document
curl -X POST http://localhost:8000/api/tender/upload \
  -F "tender_name=CRPF Construction Tender 2024" \
  -F "file=@tender.pdf"

# 2. Upload bidder documents
curl -X POST http://localhost:8000/api/bidder/upload \
  -F "tender_id=<tender_id>" \
  -F "bidder_name=ABC Construction Pvt. Ltd." \
  -F "files=@financial_statement.pdf" \
  -F "files=@experience_certificate.pdf"

# 3. Run evaluation
curl -X POST http://localhost:8000/api/evaluate \
  -H "Content-Type: application/json" \
  -d '{"tender_id": "<tender_id>", "bidder_ids": []}'

# 4. Get JSON report
curl http://localhost:8000/api/report/<report_id>

# 5. Download PDF report
curl -O http://localhost:8000/api/report/<report_id>/pdf
```

---

## Evaluation Logic

### Three-Way Verdicts

| Verdict | Condition |
|---------|-----------|
| ✅ **Eligible** | Evidence found; value meets threshold; confidence ≥ 75% |
| ❌ **Not Eligible** | Evidence missing for mandatory criterion; OR value is below required threshold |
| ⚠️ **Needs Review** | Evidence found but confidence is 40–74%; OR threshold comparison is ambiguous |

### Confidence Tiers

The system uses OCR confidence hints and regex match quality to compute confidence scores:

- **Native text documents** (typed PDF, Word, .txt): confidence ~0.95
- **Scanned PDFs** (OCR-extracted): confidence ~0.70
- **Photographs**: confidence based on Tesseract word confidence scores

### Non-Negotiables

- **Never silent disqualification**: If a bidder would be disqualified due to ambiguity (not clear failure), they are flagged for Manual Review instead
- **Criterion-level explanation**: Every verdict includes: which criterion, which document, what value was found, why it passed/failed/needs review
- **Audit trail**: Every action (upload, evaluation, report generation) is timestamped and stored

---

## Running Tests

```bash
# Run all tests
python -m pytest tests/ -v

# Run specific test modules
python -m pytest tests/test_evaluator.py -v
python -m pytest tests/test_api.py -v
```

All 58 tests run without an OpenAI API key (mock AI mode).

---

## Supported Document Formats

| Format | Parser | OCR Support |
|--------|--------|-------------|
| PDF (text-based) | PyMuPDF | No (native text) |
| PDF (scanned) | PyMuPDF + Tesseract | Yes |
| Word (.docx) | python-docx | No |
| JPEG / PNG / TIFF | Pillow + Tesseract | Yes |
| Plain text (.txt) | Built-in | No |

---

## Risks and Trade-offs

| Risk | Mitigation |
|------|-----------|
| OCR errors on low-quality scans | Low-confidence OCR triggers Needs Review instead of disqualification |
| Regex extraction misses novel criterion formats | OpenAI mode handles all formats; mock mode designed for the most common patterns |
| LLM hallucination | Structured output + confidence thresholds + human review for borderline cases |
| Threshold ambiguity (lakhs vs crores) | Currency unit detection with automatic conversion; uncertain cases flagged |
| No real tender data for testing | Sample data files in `sample_data/` model realistic CRPF procurement scenarios |

---

## Round 2 Implementation Plan

For a sandbox with sample tender and bidder documents:

1. **Calibrate AI extraction** using real tender structure and vocabulary
2. **Fine-tune confidence thresholds** based on evaluator feedback
3. **Add multi-language support** for Hindi tender documents (Tesseract `hin` language pack)
4. **Add digital signature verification** for official certificates
5. **Build CRPF-specific criterion taxonomy** trained on historical tenders
6. **Add bulk processing** for large procurement exercises (async job queue)
7. **Export to CPPP/GEM compatible formats** for government procurement platform integration
