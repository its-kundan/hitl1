# data_analytics2_router.py
# FastAPI router for Data Analytics 2 (from data_analyst folder)
# This integrates the data_analyst HITL workflow into hitl1

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import json
import uuid
import os
import asyncio
from datetime import datetime
import shutil
from pathlib import Path
import pandas as pd

# Import the HITL workflow from data_analyst
from app.hitl_analysis_workflow import create_hitl_workflow, HITLAnalysisWorkflowState

router = APIRouter(prefix="/data-analytics2", tags=["Data Analytics 2"])

# In-memory storage for workflow states
WORKFLOW_STATES: Dict[str, Dict] = {}
WORKFLOW_APPS: Dict[str, Any] = {}

# Upload directory
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# Charts directories (for serving static files)
CHARTS_DIR = Path("charts")
CHARTS_HTML_DIR = Path("charts_html")
CHARTS_DIR.mkdir(exist_ok=True)
CHARTS_HTML_DIR.mkdir(exist_ok=True)

# =============================================================================
# REQUEST/RESPONSE MODELS
# =============================================================================

class StartRequest(BaseModel):
    human_request: str
    file_path: Optional[str] = None
    file_name: Optional[str] = None

class StartResponse(BaseModel):
    thread_id: str

class SentenceFeedback(BaseModel):
    text: str
    feedback: str

class ResumeRequest(BaseModel):
    thread_id: str
    review_action: str  # "approved" or "feedback"
    human_comment: Optional[str] = None
    edited_content: Optional[str] = None
    updated_plan: Optional[List[str]] = None
    sentence_feedback: Optional[List[SentenceFeedback]] = None

# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def get_groq_api_key() -> str:
    """Get Groq API key from environment"""
    api_key = os.getenv('GROQ_API_KEY')
    if not api_key:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not found in environment")
    return api_key

def make_json_serializable(obj):
    """Convert pandas/numpy objects to JSON serializable format"""
    import pandas as pd
    import numpy as np
    
    if isinstance(obj, dict):
        return {k: make_json_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [make_json_serializable(v) for v in obj]
    elif isinstance(obj, pd.DataFrame):
        return obj.to_dict(orient='records')
    elif isinstance(obj, (np.integer, np.floating)):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif hasattr(obj, 'dtype'):
        return str(obj)
    elif isinstance(obj, (pd.Timestamp, pd.Period)):
        return str(obj)
    else:
        return obj

def _markdown_to_html(markdown_text: str) -> str:
    """Simple markdown to HTML converter"""
    import re
    
    if not markdown_text:
        return ""
    
    lines = markdown_text.split('\n')
    result = []
    in_list = False
    list_type = None
    
    for line in lines:
        line = line.rstrip()
        
        # Headers
        if line.startswith('####'):
            if in_list:
                result.append(f'</{list_type}>')
                in_list = False
            result.append(f'<h4>{line[4:].strip()}</h4>')
            continue
        elif line.startswith('###'):
            if in_list:
                result.append(f'</{list_type}>')
                in_list = False
            result.append(f'<h3>{line[3:].strip()}</h3>')
            continue
        elif line.startswith('##'):
            if in_list:
                result.append(f'</{list_type}>')
                in_list = False
            result.append(f'<h2>{line[2:].strip()}</h2>')
            continue
        elif line.startswith('#'):
            if in_list:
                result.append(f'</{list_type}>')
                in_list = False
            result.append(f'<h1>{line[1:].strip()}</h1>')
            continue
        
        # Lists
        if re.match(r'^\s*[-*+]\s+', line):
            if not in_list or list_type != 'ul':
                if in_list:
                    result.append(f'</{list_type}>')
                result.append('<ul>')
                in_list = True
                list_type = 'ul'
            item = re.sub(r'^\s*[-*+]\s+', '', line)
            result.append(f'<li>{item}</li>')
            continue
        elif re.match(r'^\s*\d+\.\s+', line):
            if not in_list or list_type != 'ol':
                if in_list:
                    result.append(f'</{list_type}>')
                result.append('<ol>')
                in_list = True
                list_type = 'ol'
            item = re.sub(r'^\s*\d+\.\s+', '', line)
            result.append(f'<li>{item}</li>')
            continue
        
        # Close list if needed
        if in_list:
            result.append(f'</{list_type}>')
            in_list = False
            list_type = None
        
        # Code blocks (simple detection)
        if line.strip().startswith('```'):
            continue
        
        # Regular paragraphs
        if line.strip():
            # Process inline formatting
            processed = line
            processed = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', processed)
            processed = re.sub(r'\*(.+?)\*', r'<em>\1</em>', processed)
            processed = re.sub(r'`(.+?)`', r'<code>\1</code>', processed)
            result.append(f'<p>{processed}</p>')
        else:
            result.append('<br>')
    
    if in_list:
        result.append(f'</{list_type}>')
    
    return '\n'.join(result)

# =============================================================================
# API ENDPOINTS
# =============================================================================

@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload a CSV file for analysis"""
    try:
        # Save uploaded file
        file_path = UPLOAD_DIR / f"{uuid.uuid4()}_{file.filename}"
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        return {
            "file_path": str(file_path),
            "file_name": file.filename,
            "status": "uploaded"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error uploading file: {str(e)}")

def _resolve_file_path(path: Optional[str]) -> Optional[str]:
    """Resolve file path to absolute so workflow can find the file regardless of cwd."""
    if not path:
        return path
    return str(Path(path).resolve()) if path else path


@router.post("/start", response_model=StartResponse)
async def start_analysis(
    human_request: str = Form(...),
    file_path: Optional[str] = Form(None),
    file_name: Optional[str] = Form(None)
):
    """Start a new HITL analysis workflow"""
    try:
        # Resolve to absolute path so backend can always find the file
        file_path = _resolve_file_path(file_path)
        # Validate file exists if provided
        if file_path and not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
        
        # Create thread ID
        thread_id = str(uuid.uuid4())
        
        # Get API key
        groq_api_key = get_groq_api_key()
        
        # Create workflow
        app, workflow_instance = create_hitl_workflow(groq_api_key)
        WORKFLOW_APPS[thread_id] = app
        
        # Initialize state
        initial_state: HITLAnalysisWorkflowState = {
            'user_query': human_request,
            'file_path': file_path,
            'dataset': None,
            'data_profile': None,
            'plan': [],
            'plan_details': None,
            'current_section_index': 0,
            'generated_sections': [],
            'human_feedback': None,
            'edited_content': None,
            'sentence_feedback': None,
            'approval_status': 'pending',
            'final_output': None,
            'final_output_original': None,
            'current_step': 'initialized',
            'error_log': []
        }
        
        # Store initial state
        config = {"configurable": {"thread_id": thread_id}}
        WORKFLOW_STATES[thread_id] = {
            'state': initial_state,
            'config': config,
            'created_at': datetime.now().isoformat()
        }
        
        return StartResponse(thread_id=thread_id)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error starting workflow: {str(e)}")

@router.post("/resume")
async def resume_analysis(request: ResumeRequest):
    """Resume workflow after human review"""
    try:
        thread_id = request.thread_id
        
        if thread_id not in WORKFLOW_STATES:
            raise HTTPException(status_code=404, detail="Thread ID not found")
        
        if thread_id not in WORKFLOW_APPS:
            raise HTTPException(status_code=404, detail="Workflow app not found")
        
        app = WORKFLOW_APPS[thread_id]
        config = WORKFLOW_STATES[thread_id]['config']
        
        # Get current state
        current_state = app.get_state(config)
        state_values = current_state.values if current_state else {}
        
        # Update state with human input
        updates = {}
        
        if request.updated_plan:
            updates['plan'] = request.updated_plan
            # Adjust current_section_index if plan changed
            if state_values.get('current_section_index', 0) >= len(request.updated_plan):
                updates['current_section_index'] = len(request.updated_plan) - 1
        
        if request.edited_content:
            updates['edited_content'] = request.edited_content
        
        if request.human_comment:
            updates['human_feedback'] = request.human_comment
        
        if request.sentence_feedback:
            updates['sentence_feedback'] = [{'text': sf.text, 'feedback': sf.feedback} for sf in request.sentence_feedback]
        
        updates['approval_status'] = request.review_action
        
        # Update state
        if updates:
            app.update_state(config, updates)
        
        # Resume workflow
        # The workflow will continue from the interrupt point
        # We'll handle streaming in the stream endpoint
        
        return {"thread_id": thread_id, "status": "resumed"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error resuming workflow: {str(e)}")

def _state_from_stream_event(event):
    """Extract state dict from LangGraph stream event (handles different yield formats)."""
    if event is None:
        return {}
    if isinstance(event, dict):
        if "current_step" in event or "user_query" in event:
            return event
        if "values" in event:
            return event["values"]
        if "__root__" in event:
            return event["__root__"]
        # Single key that might be state
        for v in event.values():
            if isinstance(v, dict) and ("current_step" in v or "user_query" in v):
                return v
            break
    if isinstance(event, (list, tuple)) and len(event) >= 2:
        return event[1] if isinstance(event[1], dict) else event[0]
    return event if isinstance(event, dict) else {}


def _run_workflow_to_interrupt(app, initial_state: dict, config: dict) -> dict:
    """Run workflow synchronously until it hits an interrupt; return final state. Used when async stream yields nothing."""
    try:
        # invoke runs until interrupt_before; then we can get state
        app.invoke(initial_state, config)
        snapshot = app.get_state(config)
        return (snapshot.values or {}) if snapshot else {}
    except Exception as e:
        print(f"Workflow invoke error: {e}")
        import traceback
        traceback.print_exc()
        return {"current_step": "error", "error_log": [str(e)]}


def _persist_workflow_state(thread_id: str, state: dict):
    """Persist serializable parts of workflow state for /report and other endpoints."""
    if thread_id not in WORKFLOW_STATES:
        return
    try:
        stub = dict(WORKFLOW_STATES[thread_id]["state"])
        for k in ["plan", "current_section_index", "current_step", "final_output", "final_output_original", "generated_sections", "error_log"]:
            if k in state and state[k] is not None:
                if k == "generated_sections" and state[k]:
                    stub[k] = make_json_serializable(state[k])
                else:
                    stub[k] = state[k]
        WORKFLOW_STATES[thread_id]["state"] = stub
    except Exception:
        pass


@router.get("/stream/{thread_id}")
async def stream_analysis(thread_id: str):
    """Stream workflow execution with SSE"""
    if thread_id not in WORKFLOW_APPS:
        raise HTTPException(status_code=404, detail="Thread ID not found")
    
    app = WORKFLOW_APPS[thread_id]
    config = WORKFLOW_STATES.get(thread_id, {}).get('config', {"configurable": {"thread_id": thread_id}})
    
    async def event_generator():
        try:
            # Get current state
            current_state = app.get_state(config)
            state_values = current_state.values if current_state else {}
            
            # Send initial status
            yield f"data: {json.dumps({'type': 'status', 'data': {'step': 'stream_started'}})}\n\n"
            
            def process_state(state):
                """Yield SSE events for one state update."""
                if not state:
                    return
                step = state.get("current_step", "")
                if step == "error":
                    err_msg = (state.get("error_log") or [""])[-1]
                    yield f"data: {json.dumps({'type': 'error', 'data': {'message': err_msg or 'Workflow error'}})}\n\n"
                    return
                yield f"data: {json.dumps({'type': 'status', 'data': {'step': step}})}\n\n"
                if state.get("data_profile"):
                    yield f"data: {json.dumps({'type': 'data_profile', 'data': make_json_serializable(state['data_profile'])})}\n\n"
                if state.get("plan"):
                    yield f"data: {json.dumps({'type': 'plan', 'data': state['plan']})}\n\n"
                if step == "section_generated":
                    current_idx = state.get("current_section_index", 0)
                    sections = state.get("generated_sections", [])
                    if current_idx < len(sections) and sections[current_idx]:
                        section = make_json_serializable(sections[current_idx])
                        section["current_index"] = current_idx
                        yield f"data: {json.dumps({'type': 'section', 'data': section})}\n\n"
                # Send user_feedback for both section_generated (interrupt before human_review) and awaiting_human_review so frontend shows review UI
                if step in ("section_generated", "awaiting_human_review"):
                    gs = state.get("generated_sections", [])
                    ci = state.get("current_section_index", 0)
                    current_chunk = make_json_serializable(gs[ci]) if gs and ci < len(gs) else None
                    payload = {
                        "plan": state.get("plan", []),
                        "current_index": ci,
                        "generated_sections": make_json_serializable(gs),
                        "current_chunk": current_chunk,
                    }
                    yield f"data: {json.dumps({'type': 'user_feedback', 'data': payload})}\n\n"
                if step == "awaiting_final_report_review":
                    yield f"data: {json.dumps({'type': 'final_report_review', 'data': {'final_output': state.get('final_output', ''), 'final_output_original': state.get('final_output_original', '')}})}\n\n"
                if step == "final_report_regenerated":
                    yield f"data: {json.dumps({'type': 'final_report_regenerated', 'data': {'final_output': state.get('final_output', '')}})}\n\n"
                    yield f"data: {json.dumps({'type': 'final_report_review', 'data': {'final_output': state.get('final_output', ''), 'final_output_original': state.get('final_output_original', '')}})}\n\n"
                if step == "finalized":
                    yield f"data: {json.dumps({'type': 'finished', 'data': {'final_output': state.get('final_output', '')}})}\n\n"
            
            break_steps = ("awaiting_human_review", "awaiting_final_report_review", "finalized", "final_report_regenerated", "error")
            
            # Check if we need to resume (stream works for resume)
            if current_state and getattr(current_state, "next", None):
                async for event in app.astream(None, config, stream_mode="values"):
                    state = _state_from_stream_event(event)
                    _persist_workflow_state(thread_id, state)
                    for chunk in process_state(state):
                        yield chunk
                    if state.get("current_step") in break_steps:
                        break
            else:
                # Initial run: workflow nodes are sync and can block the event loop.
                # Run invoke in a thread so we get state at interrupt, then stream it.
                initial_state = WORKFLOW_STATES.get(thread_id, {}).get("state", {})
                if not initial_state:
                    yield f"data: {json.dumps({'type': 'error', 'data': {'message': 'No initial state found for thread'}})}\n\n"
                    return
                yield f"data: {json.dumps({'type': 'status', 'data': {'step': 'workflow_starting'}})}\n\n"
                loop = asyncio.get_event_loop()
                state = await loop.run_in_executor(
                    None,
                    lambda: _run_workflow_to_interrupt(app, initial_state, config),
                )
                if not state:
                    yield f"data: {json.dumps({'type': 'error', 'data': {'message': 'Workflow returned no state'}})}\n\n"
                    return
                _persist_workflow_state(thread_id, state)
                for chunk in process_state(state):
                    yield chunk
        
        except Exception as e:
            import traceback
            error_trace = traceback.format_exc()
            print(f"Error in stream_analysis: {str(e)}")
            print(f"Traceback: {error_trace}")
            yield f"data: {json.dumps({'type': 'error', 'data': {'message': str(e), 'traceback': error_trace}})}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@router.get("/state/{thread_id}")
async def get_workflow_state(thread_id: str):
    """Get current workflow state"""
    if thread_id not in WORKFLOW_APPS:
        raise HTTPException(status_code=404, detail="Thread ID not found")
    
    app = WORKFLOW_APPS[thread_id]
    config = WORKFLOW_STATES.get(thread_id, {}).get('config', {"configurable": {"thread_id": thread_id}})
    
    current_state = app.get_state(config)
    state_values = current_state.values if current_state else {}
    
    return {
        "thread_id": thread_id,
        "state": make_json_serializable(state_values),
        "next": current_state.next if current_state else []
    }

# =============================================================================
# CHATBOT ENDPOINTS
# =============================================================================

CHATBOT_SESSIONS: Dict[str, Any] = {}

class ChatbotInitRequest(BaseModel):
    thread_id: str

class ChatbotChatRequest(BaseModel):
    thread_id: str
    message: str

@router.post("/chatbot/init")
async def init_chatbot(request: ChatbotInitRequest):
    """Initialize chatbot session with Gemini"""
    try:
        thread_id = request.thread_id
        if not thread_id or thread_id not in WORKFLOW_STATES:
            raise HTTPException(status_code=404, detail="Thread ID not found")
        
        from google import genai
        from PIL import Image
        from pathlib import Path
        
        # Setup Gemini
        try:
            client = genai.Client()
            model_id = "gemini-2.5-flash"
            chat_session = client.chats.create(model=model_id)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to initialize Gemini: {str(e)}")
        
        # Load charts and report from workflow state
        state_data = WORKFLOW_STATES.get(thread_id, {}).get('state', {})
        generated_sections = state_data.get('generated_sections', [])
        
        # Collect all chart paths
        chart_paths = []
        for section in generated_sections:
            if section and section.get('visualizations'):
                for viz in section['visualizations']:
                    if viz.get('png_path'):
                        chart_paths.append(viz['png_path'])
                    if viz.get('html_path'):
                        chart_paths.append(viz['html_path'])
        
        # Load images
        loaded_images = []
        for chart_path in chart_paths[:10]:  # Limit to 10 charts
            try:
                if Path(chart_path).exists():
                    img = Image.open(chart_path)
                    loaded_images.append(img)
            except Exception:
                pass
        
        # Get report content
        final_output = state_data.get('final_output', '')
        report_content = final_output if final_output else "No report generated yet."
        
        # Initialize chat with context
        system_instr = "You are an expert analyst. Use ONLY provided charts and report text. Be concise."
        initial_prompt = [
            system_instr,
            f"--- REPORT CONTENT ---\n{report_content}",
            *loaded_images,
            "I have provided the charts and report. Acknowledge and wait for my questions."
        ]
        
        chat_session.send_message(initial_prompt)
        
        # Store session
        CHATBOT_SESSIONS[thread_id] = {
            'session': chat_session,
            'client': client,
            'model_id': model_id
        }
        
        return {"status": "initialized", "message": "Chatbot ready"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error initializing chatbot: {str(e)}")

@router.post("/chatbot/chat")
async def chat_with_bot(request: ChatbotChatRequest):
    """Send message to chatbot"""
    try:
        thread_id = request.thread_id
        message = request.message
        
        if not thread_id or thread_id not in CHATBOT_SESSIONS:
            raise HTTPException(status_code=404, detail="Chatbot not initialized for this thread")
        
        if not message:
            raise HTTPException(status_code=400, detail="Message is required")
        
        session_data = CHATBOT_SESSIONS[thread_id]
        chat_session = session_data['session']
        
        # Send message and get response
        response = chat_session.send_message(message)
        
        return {"response": response.text}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error in chatbot: {str(e)}")

# =============================================================================
# REPORT ENDPOINTS
# =============================================================================

@router.get("/report")
async def get_report(thread_id: Optional[str] = None):
    """Get the generated report HTML. Optionally provide thread_id as query param to get from workflow state."""
    try:
        # First, check if HTML report file exists (generated by finalize_node)
        report_path = Path("interactive_analysis_report.html")
        # Check in current directory and parent (backend) directory
        if not report_path.exists():
            report_path = Path("..") / "interactive_analysis_report.html"
        if not report_path.exists():
            report_path = Path(".") / "interactive_analysis_report.html"
        
        if report_path.exists():
            html_content = report_path.read_text(encoding="utf-8")
            
            # Embed chart HTML files using srcdoc (like data_analyst's load_full_report_html)
            try:
                from bs4 import BeautifulSoup
                charts_html_dir = Path("charts_html")
                
                soup = BeautifulSoup(html_content, "html.parser")
                for iframe in soup.find_all("iframe"):
                    src = iframe.get("src", "") or iframe.get("data-src", "")
                    if not src: continue
                    clean_src = src.replace("file://", "").replace("\\", "/").lstrip("/")
                    chart_name = Path(clean_src).name
                    chart_path = charts_html_dir / chart_name
                    
                    if chart_path.exists():
                        chart_html = chart_path.read_text(encoding="utf-8")
                        iframe["srcdoc"] = chart_html
                        iframe["src"] = ""
                        iframe["width"] = "100%"
                        iframe["height"] = "600px"
                        iframe["sandbox"] = "allow-scripts allow-same-origin"
                        iframe["loading"] = "lazy"
                    else:
                        # Check if it's a relative path from charts_html
                        alt_path = Path("charts_html") / chart_name
                        if alt_path.exists():
                            chart_html = alt_path.read_text(encoding="utf-8")
                            iframe["srcdoc"] = chart_html
                            iframe["src"] = ""
                            iframe["width"] = "100%"
                            iframe["height"] = "600px"
                            iframe["sandbox"] = "allow-scripts allow-same-origin"
                
                return str(soup)
            except Exception as e:
                # If embedding fails, return original HTML
                print(f"Warning: Could not embed charts: {str(e)}")
                return html_content
        
        # Fallback: Generate from workflow state if thread_id provided
        if thread_id and thread_id in WORKFLOW_STATES:
            state_data = WORKFLOW_STATES[thread_id].get('state', {})
            final_output = state_data.get('final_output', '')
            
            if final_output:
                # Convert markdown to HTML (simple conversion)
                html_body = _markdown_to_html(final_output)
                
                # Wrap in HTML template
                html_template = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Data Analysis Report</title>
    <style>
        body {{
            font-family: Arial, sans-serif;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f4f7f6;
            line-height: 1.6;
        }}
        .container {{
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }}
        h1, h2, h3 {{
            color: #3f51b5;
            border-bottom: 2px solid #3f51b533;
            padding-bottom: 5px;
            margin-top: 25px;
        }}
        pre {{
            background: #f5f5f5;
            padding: 15px;
            border-radius: 4px;
            overflow-x: auto;
        }}
        code {{
            background: #f5f5f5;
            padding: 2px 6px;
            border-radius: 3px;
        }}
        .selectable-content {{
            user-select: text;
            -webkit-user-select: text;
        }}
    </style>
</head>
<body>
    <div class="container selectable-content">
        {html_body}
    </div>
</body>
</html>
"""
                return html_template
        
        # Fallback: Look for report HTML file
        report_path = Path("interactive_analysis_report.html")
        if report_path.exists():
            return report_path.read_text(encoding="utf-8")
        
        # If no report file, return empty
        return "<html><body><h3>No report generated yet.</h3></body></html>"
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading report: {str(e)}")

class ReportRegenerateRequest(BaseModel):
    general_feedback: Optional[str] = ""
    edited_text: Optional[str] = ""
    sentence_feedbacks: Optional[List[Dict[str, str]]] = []

@router.post("/report/regenerate")
async def regenerate_report(request: ReportRegenerateRequest):
    """Regenerate report with feedback using feedback_manager"""
    try:
        from app.feedback_manager import regenerate_with_feedback
        from bs4 import BeautifulSoup
        
        general_feedback = request.general_feedback or ""
        edited_text = request.edited_text or ""
        sentence_feedbacks = request.sentence_feedbacks or []
        
        # Get original report HTML
        report_path = Path("interactive_analysis_report.html")
        if not report_path.exists():
            report_path = Path("..") / "interactive_analysis_report.html"
        if not report_path.exists():
            raise HTTPException(status_code=404, detail="Report HTML file not found")
        
        original_html = report_path.read_text(encoding="utf-8")
        
        # Extract text from HTML for LLM processing
        soup = BeautifulSoup(original_html, "html.parser")
        # Remove visual elements for text extraction
        for tag in soup.find_all(["img", "iframe", "script", "style"]):
            tag.decompose()
        original_text = soup.get_text(separator='\n', strip=False)
        
        # Use edited text if provided, otherwise use original
        text_to_improve = edited_text if edited_text else original_text
        
        # Regenerate using feedback_manager
        try:
            groq_api_key = get_groq_api_key()
            
            # Convert sentence feedbacks to format expected by feedback_manager
            formatted_feedbacks = []
            for sf in sentence_feedbacks:
                formatted_feedbacks.append({
                    'selected_text': sf.get('text', ''),
                    'feedback_text': sf.get('feedback', ''),
                    'feedback_type': 'Other'
                })
            
            improved_text = regenerate_with_feedback(
                original_text=text_to_improve,
                feedbacks=formatted_feedbacks,
                general_feedback=general_feedback if general_feedback else None,
                edited_text=edited_text if edited_text else None,
                api_key=groq_api_key,
                original_html=original_html,
                text_only_mode=True
            )
            
            # Reassemble HTML with improved text and original visuals
            soup_new = BeautifulSoup(original_html, "html.parser")
            
            # Replace text in paragraphs while preserving visuals
            text_paragraphs = [p.strip() for p in improved_text.split('\n\n') if p.strip()]
            para_idx = 0
            
            for elem in soup_new.find_all(['p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li']):
                # Skip if element contains visual elements
                if elem.find(['img', 'iframe']):
                    continue
                
                # Replace text content if we have improved text
                if para_idx < len(text_paragraphs):
                    # Clear existing text
                    for text_node in elem.find_all(string=True):
                        if text_node.strip():
                            text_node.replace_with('')
                    
                    # Add improved text
                    if elem.string:
                        elem.string = text_paragraphs[para_idx]
                    else:
                        elem.append(text_paragraphs[para_idx])
                    para_idx += 1
            
            final_report_html = str(soup_new)
            
            # Save regenerated report
            final_report_path = Path("interactive_analysis_report.html")
            with open(final_report_path, 'w', encoding='utf-8') as f:
                f.write(final_report_html)
            
            return {"final_report": final_report_html}
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"Error regenerating report: {str(e)}")
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error regenerating report: {str(e)}")

@router.get("/report/download")
async def download_report():
    """Download the report HTML file"""
    from fastapi.responses import FileResponse
    
    report_path = Path("interactive_analysis_report.html")
    if not report_path.exists():
        report_path = Path("..") / "interactive_analysis_report.html"
    if report_path.exists():
        return FileResponse(
            report_path,
            media_type="text/html",
            filename="interactive_analysis_report.html"
        )
    else:
        raise HTTPException(status_code=404, detail="Report not found")

@router.post("/report/create-inline-editable")
async def create_inline_editable(request: Dict[str, str]):
    """Create inline editable version of report HTML"""
    try:
        from bs4 import BeautifulSoup
        
        html_content = request.get("html_content", "")
        if not html_content:
            raise HTTPException(status_code=400, detail="html_content is required")
        
        soup = BeautifulSoup(html_content, "html.parser")
        
        # Ensure body exists
        if not soup.body:
            body = soup.new_tag("body")
            if soup.html:
                soup.html.append(body)
            else:
                html = soup.new_tag("html")
                html.append(body)
                soup.insert(0, html)
        
        # Lock all visual elements
        for visual in soup.find_all(["img", "iframe", "svg", "canvas"]):
            visual['contenteditable'] = 'false'
            visual['style'] = (visual.get('style', '') + '; pointer-events: none; user-select: none;').strip('; ')
            visual['class'] = (visual.get('class', []) + ['locked-visual'] if isinstance(visual.get('class'), list) else ['locked-visual'])
        
        # Make text nodes editable
        for text_elem in soup.find_all(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'span', 'div']):
            if text_elem.find(["img", "iframe", "svg", "canvas"]):
                continue
            text_elem['contenteditable'] = 'true'
            text_elem['class'] = (text_elem.get('class', []) + ['editable-text'] if isinstance(text_elem.get('class'), list) else ['editable-text'])
        
        # Add CSS and scripts
        style_tag = soup.new_tag("style")
        style_tag.string = """
        .locked-visual {
            pointer-events: none !important;
            user-select: none !important;
            -webkit-user-select: none !important;
            opacity: 0.9;
            border: 2px dashed #ccc;
            padding: 4px;
        }
        .editable-text {
            outline: 1px dashed transparent;
            padding: 2px;
            transition: outline 0.2s;
        }
        .editable-text:hover {
            outline-color: #3f51b5;
            background-color: rgba(63, 81, 181, 0.05);
        }
        .editable-text:focus {
            outline: 2px solid #3f51b5;
            background-color: rgba(63, 81, 181, 0.1);
        }
        """
        if soup.head:
            soup.head.append(style_tag)
        else:
            head = soup.new_tag("head")
            head.append(style_tag)
            soup.insert(0, head)
        
        # Add text selection script
        script_tag = soup.new_tag("script")
        script_tag.string = """
        (function() {
            'use strict';
            let selectionTimeout = null;
            let justSelected = false;
            
            function handleTextSelection() {
                if (justSelected) return;
                if (selectionTimeout) clearTimeout(selectionTimeout);
                
                selectionTimeout = setTimeout(function() {
                    const selection = window.getSelection();
                    const selectedText = selection.toString().trim();
                    
                    if (selectedText && selectedText.length >= 1 && selectedText.length <= 500) {
                        if (selection.rangeCount > 0) {
                            const range = selection.getRangeAt(0);
                            const container = range.commonAncestorContainer;
                            let element = container.nodeType === 3 ? container.parentElement : container;
                            
                            let isEditable = false;
                            while (element && element !== document.body) {
                                if (element.classList && element.classList.contains('editable-text')) {
                                    isEditable = true;
                                    break;
                                }
                                element = element.parentElement;
                            }
                            
                            if (isEditable) {
                                justSelected = true;
                                try {
                                    sessionStorage.setItem('pendingTextSelection_inline_mode', JSON.stringify({
                                        text: selectedText,
                                        timestamp: Date.now()
                                    }));
                                    if (window.parent && window.parent !== window && window.parent.postMessage) {
                                        window.parent.postMessage({
                                            type: 'textSelected',
                                            text: selectedText,
                                            timestamp: Date.now()
                                        }, '*');
                                    }
                                } catch (e) {
                                    console.error('Error storing selection:', e);
                                }
                                setTimeout(function() { justSelected = false; }, 500);
                            }
                        }
                    }
                }, 150);
            }
            
            document.addEventListener('mouseup', handleTextSelection);
            document.addEventListener('keyup', function(e) {
                if (e.shiftKey || e.ctrlKey || e.metaKey) {
                    handleTextSelection();
                }
            });
        })();
        """
        if soup.head:
            soup.head.append(script_tag)
        
        return {"inline_html": str(soup)}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating inline editable: {str(e)}")

@router.post("/report/extract-text")
async def extract_text_from_html(request: Dict[str, str]):
    """Extract text content from HTML report"""
    try:
        from bs4 import BeautifulSoup
        
        html_content = request.get("html_content", "")
        if not html_content:
            raise HTTPException(status_code=400, detail="html_content is required")
        
        soup = BeautifulSoup(html_content, "html.parser")
        
        # Remove script and style elements
        for script in soup(["script", "style"]):
            script.decompose()
        
        # Remove visual elements
        for img in soup.find_all(["img", "iframe"]):
            img.decompose()
        
        # Get text
        text = soup.get_text()
        
        # Clean up whitespace
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        text = '\\n'.join(chunk for chunk in chunks if chunk)
        
        return {"text": text}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error extracting text: {str(e)}")

# =============================================================================
# STATIC FILE SERVING
# =============================================================================

@router.get("/charts/{filename}")
async def get_chart(filename: str):
    """Serve chart images"""
    from fastapi.responses import FileResponse
    
    chart_path = CHARTS_DIR / filename
    if chart_path.exists():
        return FileResponse(chart_path)
    else:
        raise HTTPException(status_code=404, detail="Chart not found")

@router.get("/charts_html/{filename}")
async def get_chart_html(filename: str):
    """Serve chart HTML files"""
    from fastapi.responses import FileResponse
    
    chart_path = CHARTS_HTML_DIR / filename
    if chart_path.exists():
        return FileResponse(chart_path, media_type="text/html")
    else:
        raise HTTPException(status_code=404, detail="Chart HTML not found")
