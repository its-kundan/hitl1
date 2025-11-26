# Human-in-the-Loop LangGraph Demo (FastAPI + React)

This project demonstrates a realistic Human-in-the-Loop (HITL) workflow using [LangGraph](https://github.com/langchain-ai/langgraph), embedded inside a Python FastAPI backend, with a React frontend. It is designed as a learning resource for developers interested in building interactive AI agent flows that pause for human input and then resume execution.

## What is Human-in-the-Loop (HITL)?

HITL systems combine automated AI workflows with critical points where human feedback or decisions are required. In this demo, a LangGraph node can pause execution, request user input via the frontend, and then continue processing once the input is received.

## Architecture Overview

- **Backend:** Python FastAPI server running an embedded LangGraph agent.
- **Frontend:** React app for interacting with the agent (sending messages, providing input when requested, viewing results).
- **Communication:** 
  - **Basic Version**: REST API endpoints with blocking request/response pattern.
  - **Advanced Version**: Server-Sent Events (SSE) for real-time streaming of LangGraph outputs.
- **State Management:** The backend manages the graph's state, including pausing and resuming at human input nodes.

## Implementation Versions

This project has two implementations available as a learning progression:

1. **Basic Version ([`basic-blocking-api`](https://github.com/esurovtsev/langgraph-hitl-fastapi-demo/tree/basic-blocking-api))**: Uses traditional blocking RESTful API calls, where the frontend waits for complete responses before updating. This is simpler to understand and implement.

2. **Advanced Version ([`advanced-streaming-sse`](https://github.com/esurovtsev/langgraph-hitl-fastapi-demo/tree/advanced-streaming-sse))**: Uses Server-Sent Events (SSE) for streaming responses from LangGraph to the frontend, providing real-time updates as the AI generates content.

To switch between versions:
```bash
# For basic implementation with blocking calls
git checkout basic-blocking-api

# For advanced implementation with streaming (default)
git checkout advanced-streaming-sse
```

## Testing the Extended HITL Scenario (SSE/Streaming)

This section demonstrates how to test a full Human-in-the-Loop (HITL) scenario using the advanced streaming server endpoints. The following curl commands walk through starting a run, streaming the response, providing feedback, streaming again, approving the answer, and finalizing the run.

1) **Create a new run**
```bash
curl -X POST -H "Content-Type: application/json" -d '{"human_request": "Explain what is HITL"}' http://localhost:8000/graph/stream/create
```

2) **Stream the result**
```bash
curl --no-buffer http://localhost:8000/graph/stream/{thread_id}
```

3) **Provide feedback**
```bash
curl -X POST -H "Content-Type: application/json" -d '{
  "thread_id": "{thread_id}",
  "review_action": "feedback",
  "human_comment": "Make your answer only one sentence short."
}' http://localhost:8000/graph/stream/resume
```

4) **Stream the revised result**
```bash
curl --no-buffer http://localhost:8000/graph/stream/{thread_id}
```

5) **Approve the answer**
```bash
curl -X POST -H "Content-Type: application/json" -d '{
  "thread_id": "{thread_id}",
  "review_action": "approved"
}' http://localhost:8000/graph/stream/resume
```

6) **Stream the final result**
```bash
curl --no-buffer http://localhost:8000/graph/stream/{thread_id}
```

## Testing the async MCP tool calling (simple)

1) **Start processing**
```bash
curl -X POST -H "Content-Type: application/json" -d '{"human_request": "Provide info about my account on github"}' http://localhost:8000/mcp/start
```

2) **Approve the tool**
```bash
curl -X POST -H "Content-Type: application/json" -d '{
  "thread_id": "{thread_id}",
  "approve_action": "approved"
}' http://localhost:8000/mcp/approve
```

3) **Start processing 2**
```bash
curl -X POST -H "Content-Type: application/json" -d '{"human_request": "Create a new github repo with the name 'langgraph-mcp'"}' http://localhost:8000/mcp/start
```

2) **Reject the tool**
```bash
curl -X POST -H "Content-Type: application/json" -d '{
  "thread_id": "{thread_id}",
  "approve_action": "rejected"
}' http://localhost:8000/mcp/approve
```


Replace `{thread_id}` with the actual thread_id you receive from the creation endpoint. You can also use the interactive API docs at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) to experiment with these endpoints.

## Learning Goals

- Understand how to embed LangGraph in a real backend application.
- See how to implement HITL workflows that pause for human input and resume programmatically.
- Learn how to connect a Python backend to a modern React frontend.
- Explore practical patterns for managing agent state and user interaction.
- Compare blocking vs streaming implementations for AI-powered applications.


## How to Run Locally

> **Quick Start?** See [SETUP.md](SETUP.md) for a condensed setup guide.

This guide will walk you through setting up and running both the backend and frontend of this project.

### Prerequisites

Before you begin, ensure you have the following installed:

- **Python 3.11+** - [Download Python](https://www.python.org/downloads/)
- **Node.js 16+ and npm** - [Download Node.js](https://nodejs.org/)
- **OpenAI API Key** - [Get your API key](https://platform.openai.com/api-keys)
- **Git** (optional, for cloning the repository)

**Optional (for MCP/GitHub features):**
- **Docker** - [Download Docker](https://www.docker.com/get-started)
- **GitHub Personal Access Token** - [Create a token](https://github.com/settings/tokens)

### Step 1: Clone or Navigate to the Project

If you haven't already, navigate to the project directory:

```bash
cd langgraph-hitl-fastapi-demo
```

### Step 2: Backend Setup

#### 2.1 Navigate to Backend Directory

```bash
cd backend
```

**Important:** All backend commands should be run from the `backend` directory.

#### 2.2 Install Python Dependencies

Install all required Python packages:

```bash
python -m pip install -r requirements.txt
```

Or if you're using Python 3 specifically:

```bash
python3 -m pip install -r requirements.txt
```

**Expected output:** You should see packages being downloaded and installed. This may take a few minutes.

#### 2.3 Configure Environment Variables

Create a `.env` file in the `backend` directory:

```bash
# On Windows (PowerShell)
New-Item -Path .env -ItemType File

# On Windows (Git Bash) or Linux/Mac
touch .env
```

Open the `.env` file and add your OpenAI API key:

```env
# Required: OpenAI API Key
# Get your key from: https://platform.openai.com/api-keys
OPENAI_API_KEY=your_openai_api_key_here

# Optional: GitHub Personal Access Token (only needed for Lesson 3 - MCP features)
# Get your token from: https://github.com/settings/tokens
# GITHUB_PERSONAL_ACCESS_TOKEN=your_github_token_here
```

**Replace `your_openai_api_key_here` with your actual OpenAI API key.**

#### 2.4 Verify Environment Setup

Test that your environment variables are loaded correctly:

```bash
python -c "from dotenv import load_dotenv; import os; load_dotenv(); print('OPENAI_API_KEY:', 'SET' if os.getenv('OPENAI_API_KEY') else 'NOT SET')"
```

You should see: `OPENAI_API_KEY: SET`

#### 2.5 Start the Backend Server

Run the FastAPI server with auto-reload enabled:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Expected output:**
```
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

**Keep this terminal window open** - the server will run in the foreground. The `--reload` flag enables automatic reloading when you make code changes.

**Alternative (Background):** To run in the background (Linux/Mac):
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
```

### Step 3: Frontend Setup

Open a **new terminal window** (keep the backend running) and navigate to the frontend directory:

```bash
cd frontend
```

#### 3.1 Install Node.js Dependencies

Install all required npm packages:

```bash
npm install
```

**Expected output:** This will download and install all dependencies. It may take 2-5 minutes depending on your internet connection.

#### 3.2 Start the Frontend Development Server

Start the React development server:

```bash
npm start
```

**Expected output:**
```
Compiling...
Compiled successfully!

You can now view langgraph-hitl-frontend in the browser.

  Local:            http://localhost:3000
  On Your Network:  http://192.168.x.x:3000

Note that the development build is not optimized.
To create a production build, use npm run build.
```

The browser should automatically open to `http://localhost:3000`. If it doesn't, manually navigate to that URL.

**Keep this terminal window open** - the frontend server will run in the foreground with hot-reload enabled.

### Step 4: Verify Everything is Running

#### 4.1 Check Backend

- **API Documentation:** Open [http://localhost:8000/docs](http://localhost:8000/docs) in your browser
  - You should see the interactive Swagger/OpenAPI documentation
  - This confirms the backend is running correctly

- **Health Check:** Visit [http://localhost:8000](http://localhost:8000)
  - You should see a JSON response or redirect to `/docs`

#### 4.2 Check Frontend

- **Frontend UI:** Open [http://localhost:3000](http://localhost:3000) in your browser
  - You should see the React application interface
  - The UI should be able to communicate with the backend at `http://localhost:8000`

### Step 5: Using the Application

#### Available Endpoints

The application provides three different lesson implementations:

1. **Lesson 1 - Blocking API** (`/graph/start`, `/graph/resume`)
   - Traditional REST API with blocking requests
   - Simple request/response pattern

2. **Lesson 2 - Streaming API** (`/graph/stream/*`)
   - Server-Sent Events (SSE) for real-time streaming
   - Provides live updates as the AI generates responses

3. **Lesson 3 - MCP Tools** (`/mcp/start`, `/mcp/approve`)
   - Async MCP tool calling with human approval
   - Requires Docker and GitHub token (optional)

#### Testing via Frontend

1. Open the frontend at [http://localhost:3000](http://localhost:3000)
2. Select a lesson from the interface
3. Enter a request (e.g., "Explain what is HITL")
4. Interact with the human-in-the-loop workflow

#### Testing via API

You can also test the API directly using curl or the interactive docs at [http://localhost:8000/docs](http://localhost:8000/docs).

### Troubleshooting

#### Backend Issues

**Problem: Module not found errors**
```bash
# Solution: Reinstall dependencies
cd backend
python -m pip install -r requirements.txt
```

**Problem: Port 8000 already in use**
```bash
# Solution: Use a different port
uvicorn app.main:app --reload --port 8001
# Then update frontend/src/AssistantService.js BASE_URL to http://localhost:8001
```

**Problem: OPENAI_API_KEY not found**
```bash
# Solution: Verify .env file exists and contains the key
cd backend
cat .env  # or type .env on Windows
# Make sure OPENAI_API_KEY=your_actual_key is present
```

**Problem: Import errors**
```bash
# Solution: Ensure you're in the backend directory
cd backend
# Verify Python path
python -c "import sys; print(sys.path)"
```

#### Frontend Issues

**Problem: npm install fails**
```bash
# Solution: Clear cache and reinstall
cd frontend
rm -rf node_modules package-lock.json  # On Windows: rmdir /s node_modules
npm cache clean --force
npm install
```

**Problem: Port 3000 already in use**
```bash
# Solution: React will prompt you to use a different port
# Or set PORT environment variable:
# Windows: set PORT=3001 && npm start
# Linux/Mac: PORT=3001 npm start
```

**Problem: Cannot connect to backend**
- Verify backend is running on `http://localhost:8000`
- Check `frontend/src/AssistantService.js` - ensure `BASE_URL` is `http://localhost:8000`
- Check browser console for CORS errors (should be handled by backend CORS config)

**Problem: Frontend won't compile**
```bash
# Solution: Check Node.js version (should be 16+)
node --version
# Update if needed, then:
cd frontend
rm -rf node_modules
npm install
```

#### General Issues

**Problem: Both servers won't start**
- Ensure you have separate terminal windows for backend and frontend
- Check that required ports (3000, 8000) are not blocked by firewall
- Verify all prerequisites are installed correctly

**Problem: Changes not reflecting**
- Backend: The `--reload` flag should auto-reload. If not, restart the server
- Frontend: React hot-reload should work automatically. If not, save the file again or refresh the browser

### Running in Production

#### Backend Production

```bash
cd backend
# Install production dependencies (if any)
uvicorn app.main:app --host 0.0.0.0 --port 8000
# Remove --reload flag for production
```

#### Frontend Production

```bash
cd frontend
npm run build
# Serve the build folder using a web server like nginx or serve
npx serve -s build -p 3000
```

### Project Structure

```
langgraph-hitl-fastapi-demo/
├── backend/                 # Python FastAPI backend
│   ├── app/                # Application code
│   │   ├── main.py        # FastAPI app entry point
│   │   ├── graph.py       # LangGraph definition
│   │   ├── lesson_*.py    # API route handlers
│   │   └── ...
│   ├── config/            # Configuration files
│   ├── requirements.txt   # Python dependencies
│   └── .env              # Environment variables (create this)
├── frontend/              # React frontend
│   ├── src/              # Source code
│   ├── public/           # Static files
│   ├── package.json      # Node.js dependencies
│   └── ...
└── README.md             # This file
```

### Next Steps

- Explore the interactive API documentation at [http://localhost:8000/docs](http://localhost:8000/docs)
- Try different lessons through the frontend interface
- Review the code in `backend/app/` to understand the implementation
- Check out the notebooks in `backend/notebooks/` for learning examples

### Getting Help

- Check the [API documentation](http://localhost:8000/docs) for endpoint details
- Review the code comments in the lesson files
- See the testing examples in the README above for curl commands
