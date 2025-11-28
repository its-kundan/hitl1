# HITL Workflow Demo Guide

## Overview
This guide demonstrates how the Human-in-the-Loop (HITL) Gen AI workflow works through a clear, step-by-step demo.

## What is HITL?
Human-in-the-Loop (HITL) is a workflow pattern where AI processes pause at critical decision points to request human input, feedback, or approval before continuing. This ensures human oversight and quality control in AI-generated content.

## Workflow Stages

Our custom Gen AI workflow has 4 distinct stages:

```
┌─────────────┐
│   START     │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  RESEARCH   │ ← AI gathers information about the topic
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   DRAFT     │ ← AI creates content based on research
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ HUMAN REVIEW│ ← ⏸️ PAUSE FOR HITL (Human provides feedback/approval)
└──────┬──────┘
       │
       ├─→ [APPROVED] ──→ ┌──────────┐ ──→ END
       │                  │ FINALIZE │
       │                  └──────────┘
       │
       └─→ [FEEDBACK] ──→ ┌──────────┐ ──→ [HUMAN REVIEW] ──→ ...
                          │   DRAFT   │
                          └──────────┘
```

## Demo Methods

### Method 1: Interactive Web UI (Recommended for Live Demo)

1. **Start the servers:**
   ```bash
   # Terminal 1: Backend
   cd backend
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   
   # Terminal 2: Frontend
   cd frontend
   npm start
   ```

2. **Open the demo:**
   - Navigate to http://localhost:3000
   - Select "Custom Workflow (4-Stage)" mode from the workflow selector
   - This will show the enhanced UI with stage indicators

3. **Demo Steps:**
   - **Step 1:** Enter a query like "Write a blog post about renewable energy"
   - **Step 2:** Watch the Research stage (AI gathers information) - shown with 🔍 icon
   - **Step 3:** Watch the Draft stage (AI creates content) - shown with ✍️ icon
   - **Step 4:** ⏸️ **HITL PAUSE** - Review the draft and provide feedback
     - Notice the workflow automatically pauses at the Human Review stage
     - The UI clearly shows "PAUSED FOR HUMAN INPUT"
   - **Step 5:** Choose to Approve or Provide Feedback
     - **If feedback given:** Watch AI revise the draft (revision count increases)
     - **If approved:** Watch the Finalize stage
   - **Step 6:** If approved, watch the Finalize stage (✨ icon)
   - **Step 7:** See the final polished output

### Method 2: Command Line Demo Script

```bash
cd backend
python demo_custom_workflow.py
```

Follow the interactive prompts to see the workflow in action. The script will:
- Show each stage as it executes
- Display streaming content from each node
- Pause for your input at the human review stage
- Allow you to provide feedback or approve

### Method 3: API Demo (for Technical Audiences)

Use curl commands to demonstrate the API:

```bash
# 1. Start workflow
curl -X POST -H "Content-Type: application/json" \
  -d '{"human_request": "Write about renewable energy"}' \
  http://localhost:8000/custom/start

# Note the thread_id from the response, then:

# 2. Stream execution (shows Research + Draft stages)
curl --no-buffer http://localhost:8000/custom/stream/{thread_id}

# 3. Provide feedback (HITL interaction)
curl -X POST -H "Content-Type: application/json" \
  -d '{"thread_id": "{thread_id}", "review_action": "feedback", "human_comment": "Add statistics"}' \
  http://localhost:8000/custom/resume

# 4. Stream revised draft
curl --no-buffer http://localhost:8000/custom/stream/{thread_id}

# 5. Approve the draft
curl -X POST -H "Content-Type: application/json" \
  -d '{"thread_id": "{thread_id}", "review_action": "approved"}' \
  http://localhost:8000/custom/resume

# 6. Stream final output
curl --no-buffer http://localhost:8000/custom/stream/{thread_id}
```

## Key HITL Concepts Demonstrated

1. **Automatic Pause**: The workflow automatically pauses before the human review stage
   - This is achieved using `interrupt_before=["human_review"]` in LangGraph
   - The state is persisted using `MemorySaver` checkpointer

2. **State Persistence**: The workflow state is saved, allowing resumption after human input
   - All context (research, draft, feedback) is maintained
   - Multiple feedback cycles are supported

3. **Conditional Routing**: Based on human decision (approve/feedback), the workflow takes different paths
   - Approved → Finalize → End
   - Feedback → Draft (revise) → Human Review → ...

4. **Iterative Refinement**: Multiple feedback cycles are supported
   - Each revision is tracked with a revision count
   - Previous drafts and feedback are preserved in state

5. **Real-time Streaming**: See each stage as it happens
   - Server-Sent Events (SSE) provide live updates
   - Each node's output streams token by token
   - Clear visual indicators show which stage is active

## Demo Talking Points

When demonstrating, highlight:

- **"Notice how the workflow pauses automatically"** - This is the HITL mechanism in action. The AI doesn't proceed without human oversight.
- **"The AI waits for your input"** - Human oversight is built into the flow, not an afterthought.
- **"You can provide feedback multiple times"** - Iterative improvement is a key feature of HITL workflows.
- **"The state is preserved"** - Context is maintained across all stages, even after pauses.
- **"Each stage is clearly visible"** - Transparency in AI processing builds trust.
- **"The workflow adapts based on your decisions"** - Conditional routing shows the flexibility of HITL.

## Visual Indicators in the Demo

The enhanced UI shows:
- **Stage Progress Bar**: Visual indicator of which stage is active
- **Stage Headers**: Clear labels (🔍 Research, ✍️ Draft, 👤 Review, ✨ Finalize)
- **HITL Badge**: Special indicator when paused for human input
- **Revision Counter**: Shows how many times feedback has been incorporated
- **Color Coding**: Different colors for each stage

## Troubleshooting Demo Issues

- **Backend not responding**: 
  - Check `http://localhost:8000/docs` is accessible
  - Verify backend server is running: `uvicorn app.main:app --reload`
  - Check console for errors

- **Frontend not loading**: 
  - Verify both servers are running (backend on 8000, frontend on 3000)
  - Check browser console for errors
  - Ensure CORS is configured correctly

- **Streaming not working**: 
  - Check browser console for SSE connection errors
  - Verify EventSource is supported (modern browsers)
  - Check network tab for streaming events

- **API key issues**: 
  - Verify `.env` file exists in `backend/` directory
  - Ensure `OPENAI_API_KEY=your_key_here` is set
  - Check backend logs for authentication errors

- **Workflow not pausing**: 
  - Verify `interrupt_before=["human_review"]` is set in `custom_workflow.py`
  - Check that checkpointer is configured correctly
  - Review backend logs for state management issues

## Architecture Deep Dive

### Backend Components

- **`custom_workflow.py`**: Defines the 4-stage workflow graph
  - Research node: Gathers information
  - Draft node: Creates content
  - Human review node: HITL pause point
  - Finalize node: Polishes approved content

- **`lesson_04_custom.py`**: API endpoints for the workflow
  - `/custom/start`: Initialize workflow
  - `/custom/resume`: Resume after human review
  - `/custom/stream/{thread_id}`: Stream execution

### Frontend Components

- **`CustomWorkflowDemo.js`**: Enhanced UI component
  - Stage visualization
  - Real-time streaming display
  - Feedback interface
  - Progress tracking

- **`AssistantService.js`**: API service layer
  - `createCustomWorkflow()`: Start workflow
  - `resumeCustomWorkflow()`: Resume with feedback
  - `streamCustomWorkflow()`: Stream with node info

## Next Steps After Demo

After demonstrating the workflow, you can:

1. **Explore the Code**:
   - Review `backend/app/custom_workflow.py` to see workflow definition
   - Check `backend/app/lesson_04_custom.py` for API implementation
   - Examine `frontend/src/CustomWorkflowDemo.js` for UI logic

2. **Customize the Workflow**:
   - Add more stages (e.g., fact-checking, formatting)
   - Integrate external tools (similar to MCP pattern)
   - Add more sophisticated routing logic

3. **Enhance the UI**:
   - Add more visual indicators
   - Include progress percentages
   - Show estimated time per stage

4. **Production Considerations**:
   - Replace in-memory storage with database
   - Add authentication and authorization
   - Implement rate limiting
   - Add monitoring and logging

## Example Demo Script

Here's a sample script for presenting the demo:

1. **Introduction** (30 seconds)
   - "Today I'll demonstrate a Human-in-the-Loop Gen AI workflow"
   - "This shows how AI can work with human oversight for quality control"

2. **Start Workflow** (1 minute)
   - Enter query: "Write a blog post about renewable energy"
   - Point out: "Notice the workflow starts automatically"

3. **Research Stage** (30 seconds)
   - "The AI first gathers information about the topic"
   - "This is the research stage - see the 🔍 indicator"

4. **Draft Stage** (30 seconds)
   - "Now it creates a draft based on the research"
   - "Watch the content stream in real-time"

5. **HITL Pause** (1 minute)
   - "Here's the key part - the workflow automatically pauses"
   - "This is the Human-in-the-Loop mechanism"
   - "The AI is waiting for human input before proceeding"

6. **Provide Feedback** (1 minute)
   - Enter feedback: "Add statistics and make it more technical"
   - "I'm providing feedback to improve the draft"
   - "Notice the revision count increases"

7. **Revised Draft** (30 seconds)
   - "The AI incorporates my feedback"
   - "We can iterate multiple times if needed"

8. **Approve** (30 seconds)
   - "I'll approve this version"
   - "This triggers the finalize stage"

9. **Finalize** (30 seconds)
   - "The AI polishes the approved content"
   - "This is the final output"

10. **Summary** (30 seconds)
    - "This demonstrates how HITL ensures quality through human oversight"
    - "The workflow is transparent, iterative, and human-controlled"

**Total demo time: ~7 minutes**

## Additional Resources

- **LangGraph Documentation**: https://langchain-ai.github.io/langgraph/
- **FastAPI Documentation**: https://fastapi.tiangolo.com/
- **React Documentation**: https://react.dev/
- **Project README**: See [README.md](README.md) for setup instructions
- **Implementation Summary**: See [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) for technical details




