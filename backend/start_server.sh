#!/bin/bash
echo "Starting FastAPI Backend Server..."
echo ""
cd "$(dirname "$0")"
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000



