# Quick Setup Guide

This is a condensed version of the setup instructions. For detailed information, see [README.md](README.md).

## Quick Start (5 minutes)

### 1. Backend Setup

```bash
# Navigate to backend
cd backend

# Install dependencies
python -m pip install -r requirements.txt

# Create .env file with your OpenAI API key
echo "OPENAI_API_KEY=your_key_here" > .env

# Start server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 2. Frontend Setup (New Terminal)

```bash
# Navigate to frontend
cd frontend

# Install dependencies
npm install

# Start development server
npm start
```

### 3. Access

- **Frontend:** http://localhost:3000
- **Backend API Docs:** http://localhost:8000/docs

## Prerequisites Checklist

- [ ] Python 3.11+ installed
- [ ] Node.js 16+ installed
- [ ] OpenAI API key obtained
- [ ] (Optional) Docker installed (for MCP features)
- [ ] (Optional) GitHub token (for MCP features)

## Common Commands

### Backend
```bash
cd backend
uvicorn app.main:app --reload          # Start with auto-reload
uvicorn app.main:app --reload --port 8001  # Use different port
```

### Frontend
```bash
cd frontend
npm start                    # Start dev server
npm run build               # Build for production
PORT=3001 npm start         # Use different port
```

## Environment Variables

Create `backend/.env`:
```env
OPENAI_API_KEY=sk-...                    # Required
GITHUB_PERSONAL_ACCESS_TOKEN=ghp_...     # Optional (for MCP)
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Module not found | `pip install -r requirements.txt` |
| Port in use | Change port with `--port` flag |
| API key error | Check `.env` file exists and has correct key |
| npm install fails | `rm -rf node_modules && npm install` |
| Can't connect | Verify both servers are running |

## Need More Help?

See the full documentation in [README.md](README.md) for detailed instructions, troubleshooting, and examples.

