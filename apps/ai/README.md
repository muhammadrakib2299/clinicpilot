# ClinicPilot AI Service

Python + FastAPI service for LLM reasoning, tool-use, RAG, and PHI redaction.

## Run (dev)

```bash
cd apps/ai
python -m venv .venv
# Windows: .venv\Scripts\activate   |  *nix: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# -> http://localhost:8000/health   |  docs: http://localhost:8000/docs
```
