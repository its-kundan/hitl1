# data_analytics2_router.py
# FastAPI router for Data Analytics 2 (from data_analyst folder)
# This integrates the data_analyst HITL workflow into hitl1

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import json
import uuid
import os
from datetime import datetime
import shutil
from pathlib import Path

# Import the existing data_analysis_workflow as a fallback
from data_analysis_workflow import data_analysis_graph, DataAnalysisWorkflowState

router = APIRouter(prefix="/data-analytics2", tags=["Data Analytics 2"])

# In-memory storage for workflow states
WORKFLOW_STATES: Dict[str, Dict] = {}
WORKFLOW_APPS: Dict[str, Any] = {}

# Upload directory
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# =============================================================================
# REQUEST/RESPONSE MODELS
# =============================================================================

class StartRequest(BaseModel):
    human_request: str
    file_path: Optional[str] = None
    file_name: Optional[str] = None

class StartResponse(BaseModel):
    thread_id: str

class ResumeRequest(BaseModel):
    thread_id: str
    review_action: str  # "approved" or "feedback"
    human_comment: Optional[str] = None
    edited_content: Optional[str] = None
    updated_plan: Optional[List[str]] = None
    sentence_feedback: Optional[List[Dict[str, str]]] = None

# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

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

@router.post("/start", response_model=StartResponse)
async def start_analysis(
    human_request: str = Form(...),
    file_path: Optional[str] = Form(None),
    file_name: Optional[str] = Form(None)
):
    """Start a new data analysis workflow"""
    try:
        # Create thread ID
        thread_id = str(uuid.uuid4())
        
        # Validate file exists if provided
        if file_path and not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
        
        # Use existing data_analysis_graph
        app = data_analysis_graph
        WORKFLOW_APPS[thread_id] = app
        
        # Initialize state
        initial_state = {
            'user_query': human_request,
            'file_path': file_path,
            'file_name': file_name,
            'data_summary': None,
            'data_preview': None,
            'analysis_plan': None,
            'generated_code': None,
            'code_execution_results': None,
            'visualization_code': None,
            'visualization_path': None,
            'visualization_paths': [],
            'human_feedback': None,
            'approval_status': 'pending',
            'final_report': None,
            'revision_count': 0,
            'interrupt_requested': False,
            'current_stage': None,
            'messages': []
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
        
        if request.edited_content:
            updates['edited_content'] = request.edited_content
        
        if request.human_comment:
            updates['human_feedback'] = request.human_comment
        
        if request.sentence_feedback:
            updates['sentence_feedback'] = request.sentence_feedback
        
        updates['approval_status'] = request.review_action
        
        # Update state
        if updates:
            app.update_state(config, updates)
        
        return {"thread_id": thread_id, "status": "resumed"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error resuming workflow: {str(e)}")

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
            
            # Check if we need to resume
            if current_state and hasattr(current_state, 'next') and current_state.next:
                # Resume from interrupt
                async for event in app.astream(None, config, stream_mode="values"):
                    state = event
                    
                    # Send status update
                    yield f"data: {json.dumps({'type': 'status', 'data': {'stage': state.get('current_stage', 'unknown')}})}\n\n"
                    
                    # Send data summary if available
                    if state.get('data_summary'):
                        yield f"data: {json.dumps({'type': 'data_summary', 'data': state.get('data_summary')})}\n\n"
                    
                    # Send analysis plan if available
                    if state.get('analysis_plan'):
                        yield f"data: {json.dumps({'type': 'analysis_plan', 'data': state.get('analysis_plan')})}\n\n"
                    
                    # Send generated code if available
                    if state.get('generated_code'):
                        yield f"data: {json.dumps({'type': 'generated_code', 'data': state.get('generated_code')})}\n\n"
                    
                    # Send execution results if available
                    if state.get('code_execution_results'):
                        yield f"data: {json.dumps({'type': 'execution_results', 'data': state.get('code_execution_results')})}\n\n"
                    
                    # Send visualization paths if available
                    if state.get('visualization_paths'):
                        yield f"data: {json.dumps({'type': 'visualizations', 'data': make_json_serializable(state.get('visualization_paths', []))})}\n\n"
                    
                    # Check if paused for review
                    if state.get('current_stage') == 'human_review' or state.get('approval_status') == 'pending':
                        yield f"data: {json.dumps({'type': 'user_feedback', 'data': {'stage': state.get('current_stage'), 'approval_status': state.get('approval_status')}})}\n\n"
                        break
                    
                    # Check if finalized
                    if state.get('final_report'):
                        yield f"data: {json.dumps({'type': 'finished', 'data': {'final_report': state.get('final_report')}})}\n\n"
                        break
            else:
                # Initial run
                initial_state = WORKFLOW_STATES.get(thread_id, {}).get('state', {})
                async for event in app.astream(initial_state, config, stream_mode="values"):
                    state = event
                    
                    # Send status update
                    yield f"data: {json.dumps({'type': 'status', 'data': {'stage': state.get('current_stage', 'unknown')}})}\n\n"
                    
                    # Send data summary if available
                    if state.get('data_summary'):
                        yield f"data: {json.dumps({'type': 'data_summary', 'data': state.get('data_summary')})}\n\n"
                    
                    # Send analysis plan if available
                    if state.get('analysis_plan'):
                        yield f"data: {json.dumps({'type': 'analysis_plan', 'data': state.get('analysis_plan')})}\n\n"
                    
                    # Send generated code if available
                    if state.get('generated_code'):
                        yield f"data: {json.dumps({'type': 'generated_code', 'data': state.get('generated_code')})}\n\n"
                    
                    # Send execution results if available
                    if state.get('code_execution_results'):
                        yield f"data: {json.dumps({'type': 'execution_results', 'data': state.get('code_execution_results')})}\n\n"
                    
                    # Send visualization paths if available
                    if state.get('visualization_paths'):
                        yield f"data: {json.dumps({'type': 'visualizations', 'data': make_json_serializable(state.get('visualization_paths', []))})}\n\n"
                    
                    # Check if paused for review
                    if state.get('current_stage') == 'human_review' or state.get('approval_status') == 'pending':
                        yield f"data: {json.dumps({'type': 'user_feedback', 'data': {'stage': state.get('current_stage'), 'approval_status': state.get('approval_status')}})}\n\n"
                        break
                    
                    # Check if finalized
                    if state.get('final_report'):
                        yield f"data: {json.dumps({'type': 'finished', 'data': {'final_report': state.get('final_report')}})}\n\n"
                        break
        
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'data': {'message': str(e)}})}\n\n"
    
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
