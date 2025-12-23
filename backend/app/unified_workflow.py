# Unified Interactive Workflow
# Combines all lessons into a single, real-time interactive human-in-the-loop system
# Supports: Basic HITL, Custom Workflow, Data Analysis, Editable Content, MCP Tools

from fastapi import APIRouter, Request, UploadFile, File, Form
from uuid import uuid4
from app.models import StartRequest, GraphResponse, ResumeRequest, ApproveRequest
from app.graph import graph as basic_graph
from app.custom_workflow import custom_graph
from app.data_analysis_workflow import data_analysis_graph
from app.editable_workflow import editable_graph
from app.mcp_agent import get_agent
from sse_starlette.sse import EventSourceResponse
from langgraph.types import Command
from langchain_core.messages import HumanMessage
from typing import Optional, Dict, Literal
from pydantic import BaseModel
import json
import os
import shutil

router = APIRouter()

# In-memory storage for run configurations
run_configs = {}
uploads_dir = os.path.join(os.path.dirname(__file__), "..", "uploads")
os.makedirs(uploads_dir, exist_ok=True)


# --- Request Models ---
class UnifiedStartRequest(BaseModel):
    workflow_type: Literal["basic", "custom", "data_analysis", "editable", "mcp"]
    user_query: str
    file_path: Optional[str] = None
    file_name: Optional[str] = None


class UnifiedResumeRequest(BaseModel):
    thread_id: str
    workflow_type: Literal["basic", "custom", "data_analysis", "editable", "mcp"]
    action: Literal["approved", "feedback", "rejected", "editing"]
    human_comment: Optional[str] = None
    edited_sentences: Optional[Dict[str, str]] = None
    sentence_feedback: Optional[Dict[str, str]] = None


# --- File Upload Endpoint ---
@router.post("/unified/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload a file for data analysis workflow."""
    try:
        files_dir = os.path.join(uploads_dir, "files")
        os.makedirs(files_dir, exist_ok=True)
        
        file_id = str(uuid4())
        file_extension = os.path.splitext(file.filename)[1] or ".csv"
        saved_filename = f"{file_id}{file_extension}"
        file_path = os.path.join(files_dir, saved_filename)
        
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        return {
            "file_path": file_path,
            "file_name": file.filename,
            "saved_filename": saved_filename,
            "message": "File uploaded successfully"
        }
    except Exception as e:
        return {"error": f"Error uploading file: {str(e)}"}


# --- Start Workflow Endpoint ---
@router.post("/unified/start", response_model=GraphResponse)
def start_unified_workflow(request: UnifiedStartRequest):
    """
    Start any workflow type with a unified interface.
    Creates a thread and initializes the workflow.
    """
    thread_id = str(uuid4())
    
    run_configs[thread_id] = {
        "type": "start",
        "workflow_type": request.workflow_type,
        "user_query": request.user_query,
        "file_path": request.file_path,
        "file_name": request.file_name
    }
    
    return GraphResponse(
        thread_id=thread_id,
        run_status="pending",
        assistant_response=None
    )


# --- Resume Workflow Endpoint ---
@router.post("/unified/resume", response_model=GraphResponse)
def resume_unified_workflow(request: UnifiedResumeRequest):
    """
    Resume any paused workflow after human interaction.
    Supports all workflow types with their specific resume patterns.
    """
    thread_id = request.thread_id
    
    run_configs[thread_id] = {
        "type": "resume",
        "workflow_type": request.workflow_type,
        "action": request.action,
        "human_comment": request.human_comment,
        "edited_sentences": request.edited_sentences,
        "sentence_feedback": request.sentence_feedback
    }
    
    return GraphResponse(
        thread_id=thread_id,
        run_status="pending",
        assistant_response=None
    )


# --- Interrupt Endpoint (for data analysis) ---
@router.post("/unified/interrupt")
async def interrupt_workflow(
    thread_id: str = Form(...),
    message: str = Form(...)
):
    """Send an interrupt message during workflow execution (mainly for data analysis)."""
    if thread_id not in run_configs:
        return {"error": "Thread ID not found"}
    
    config = {"configurable": {"thread_id": thread_id}}
    workflow_type = run_configs[thread_id].get("workflow_type", "basic")
    
    if workflow_type == "data_analysis":
        state = data_analysis_graph.get_state(config)
        if state.values:
            state_update = {
                "interrupt_requested": True,
                "human_feedback": message,
                "approval_status": "feedback"
            }
            data_analysis_graph.update_state(config, state_update)
            return {
                "thread_id": thread_id,
                "message": "Interrupt message received",
                "status": "interrupted"
            }
    
    return {"error": "Interrupt not supported for this workflow type"}


# --- Main Streaming Endpoint ---
@router.get("/unified/stream/{thread_id}")
async def stream_unified_workflow(request: Request, thread_id: str):
    """
    Stream any workflow type with real-time updates.
    Provides unified SSE streaming for all workflow types.
    """
    if thread_id not in run_configs:
        # Check if thread exists in any graph state
        config = {"configurable": {"thread_id": thread_id}}
        # Try to get state from any graph
        for graph in [basic_graph, custom_graph, data_analysis_graph, editable_graph]:
            try:
                state = graph.get_state(config)
                if state.values:
                    # Infer workflow type from state structure
                    if "user_query" in state.values and "research_results" in state.values:
                        workflow_type = "custom"
                    elif "file_path" in state.values or "generated_code" in state.values:
                        workflow_type = "data_analysis"
                    elif "edited_sentences" in state.values:
                        workflow_type = "editable"
                    else:
                        workflow_type = "basic"
                    run_configs[thread_id] = {
                        "type": "resume",
                        "workflow_type": workflow_type
                    }
                    break
            except:
                continue
        
        if thread_id not in run_configs:
            return {"error": "Thread ID not found. You must first call /unified/start"}
    
    run_data = run_configs[thread_id]
    workflow_type = run_data.get("workflow_type", "basic")
    config = {"configurable": {"thread_id": thread_id}}
    
    # Select the appropriate graph
    selected_graph = None
    if workflow_type == "basic":
        selected_graph = basic_graph
    elif workflow_type == "custom":
        selected_graph = custom_graph
    elif workflow_type == "data_analysis":
        selected_graph = data_analysis_graph
    elif workflow_type == "editable":
        selected_graph = editable_graph
    elif workflow_type == "mcp":
        # MCP uses async agent, handle separately
        pass
    else:
        return {"error": f"Unknown workflow type: {workflow_type}"}
    
    # Handle MCP workflow separately (async)
    if workflow_type == "mcp":
        return await stream_mcp_workflow(request, thread_id, run_data, config)
    
    # Prepare input state based on workflow type and operation type
    input_state = None
    if run_data["type"] == "start":
        event_type = "start"
        if workflow_type == "basic":
            input_state = {"human_request": run_data["user_query"]}
        elif workflow_type == "custom":
            input_state = {"user_query": run_data["user_query"]}
        elif workflow_type == "data_analysis":
            input_state = {
                "user_query": run_data["user_query"],
                "file_path": run_data.get("file_path"),
                "file_name": run_data.get("file_name")
            }
        elif workflow_type == "editable":
            input_state = {"user_query": run_data["user_query"]}
    else:
        event_type = "resume"
        # Update state based on workflow type
        state_update = {}
        
        if workflow_type == "basic":
            state_update = {"status": run_data["action"]}
            if run_data.get("human_comment"):
                state_update["human_comment"] = run_data["human_comment"]
        elif workflow_type == "custom":
            state_update = {"approval_status": run_data["action"]}
            if run_data.get("human_comment"):
                state_update["human_feedback"] = run_data["human_comment"]
        elif workflow_type == "data_analysis":
            state_update = {"approval_status": run_data["action"]}
            if run_data.get("human_comment"):
                state_update["human_feedback"] = run_data["human_comment"]
        elif workflow_type == "editable":
            state_update = {"approval_status": run_data["action"]}
            if run_data.get("edited_sentences"):
                state_update["edited_sentences"] = run_data["edited_sentences"]
            if run_data.get("sentence_feedback"):
                state_update["sentence_feedback"] = run_data["sentence_feedback"]
            if run_data.get("human_comment"):
                state_update["human_feedback"] = run_data["human_comment"]
        
        selected_graph.update_state(config, state_update)
    
    # Define node names to stream for each workflow type
    streamable_nodes = {
        "basic": ["assistant_draft", "assistant_finalize"],
        "custom": ["research", "draft", "finalize"],
        "data_analysis": ["data_exploration", "analysis_planning", "code_generation", 
                         "code_execution", "visualization_generation", "finalize"],
        "editable": ["generate_initial", "incorporate_edits", "finalize"]
    }
    
    async def event_generator():
        # Initial event
        initial_data = json.dumps({
            "thread_id": thread_id,
            "workflow_type": workflow_type
        })
        yield {"event": event_type, "data": initial_data}
        
        try:
            # Stream messages from the graph
            for msg, metadata in selected_graph.stream(input_state, config, stream_mode="messages"):
                if await request.is_disconnected():
                    break
                
                node_name = metadata.get('langgraph_node', '')
                if node_name in streamable_nodes.get(workflow_type, []):
                    try:
                        content = None
                        if hasattr(msg, 'content'):
                            content = msg.content
                        elif isinstance(msg, dict):
                            content = msg.get('content', '')
                        elif hasattr(msg, 'get'):
                            content = msg.get('content', '')
                        else:
                            content = str(msg) if msg else ''
                        
                        if content is None:
                            content = ''
                        else:
                            content = str(content)
                        
                        token_data = json.dumps({
                            "content": content,
                            "node": node_name,
                            "workflow_type": workflow_type
                        }, ensure_ascii=False)
                        yield {"event": "token", "data": token_data}
                    except Exception as e:
                        print(f"DEBUG: Error processing message: {str(e)}")
                        continue
            
            # Check final state and determine next action
            state = selected_graph.get_state(config)
            status_data = {"workflow_type": workflow_type}
            
            if state.next:
                next_nodes = [node for node in state.next if isinstance(node, str)]
                
                if workflow_type == "basic":
                    if 'human_feedback' in next_nodes:
                        status_data.update({
                            "status": "user_feedback",
                            "assistant_response": state.values.get('assistant_response', '')
                        })
                    else:
                        status_data.update({
                            "status": "finished",
                            "assistant_response": state.values.get('assistant_response', '')
                        })
                
                elif workflow_type == "custom":
                    if 'human_review' in next_nodes:
                        status_data.update({
                            "status": "user_feedback",
                            "draft_content": state.values.get('draft_content', '')
                        })
                    else:
                        status_data.update({
                            "status": "finished",
                            "final_output": state.values.get('final_output', state.values.get('draft_content', ''))
                        })
                
                elif workflow_type == "data_analysis":
                    if 'human_review' in next_nodes:
                        status_data.update({
                            "status": "user_feedback",
                            "code": state.values.get('generated_code', ''),
                            "visualization_path": state.values.get('visualization_path', ''),
                            "visualization_paths": state.values.get('visualization_paths', []),
                            "current_stage": "human_review"
                        })
                    elif 'code_generation' in next_nodes:
                        status_data.update({
                            "status": "code_review",
                            "analysis_plan": state.values.get('analysis_plan', ''),
                            "current_stage": "code_generation"
                        })
                    else:
                        status_data.update({
                            "status": "finished",
                            "final_output": state.values.get('final_report', ''),
                            "code": state.values.get('generated_code', ''),
                            "visualization_path": state.values.get('visualization_path', ''),
                            "visualization_paths": state.values.get('visualization_paths', [])
                        })
                
                elif workflow_type == "editable":
                    if 'human_edit' in next_nodes:
                        status_data.update({
                            "status": "editing",
                            "current_content": state.values.get('current_content', ''),
                            "sentences": state.values.get('edited_sentences', {}),
                            "revision_count": state.values.get('revision_count', 0)
                        })
                    else:
                        status_data.update({
                            "status": "finished",
                            "final_output": state.values.get('final_output', state.values.get('current_content', ''))
                        })
            else:
                # Workflow finished
                status_data["status"] = "finished"
                if workflow_type == "basic":
                    status_data["assistant_response"] = state.values.get('assistant_response', '')
                elif workflow_type == "custom":
                    status_data["final_output"] = state.values.get('final_output', '')
                elif workflow_type == "data_analysis":
                    status_data.update({
                        "final_output": state.values.get('final_report', ''),
                        "code": state.values.get('generated_code', ''),
                        "visualization_path": state.values.get('visualization_path', '')
                    })
                elif workflow_type == "editable":
                    status_data["final_output"] = state.values.get('final_output', '')
            
            yield {"event": "status", "data": json.dumps(status_data, ensure_ascii=False)}
            
            # Clean up
            if thread_id in run_configs:
                del run_configs[thread_id]
                
        except Exception as e:
            error_msg = str(e) if e else "Unknown error occurred"
            print(f"DEBUG: Exception in event_generator: {error_msg}")
            import traceback
            traceback.print_exc()
            try:
                error_data = json.dumps({"error": error_msg}, ensure_ascii=False)
                yield {"event": "error", "data": error_data}
            except:
                pass
            
            if thread_id in run_configs:
                del run_configs[thread_id]
    
    return EventSourceResponse(event_generator())


# --- MCP Workflow Streaming (Async) ---
async def stream_mcp_workflow(request: Request, thread_id: str, run_data: dict, config: dict):
    """Handle MCP workflow streaming (uses async agent)."""
    # MCP workflow is more complex and uses async agent
    # For now, return a simple error message
    # This can be enhanced later to support full MCP streaming
    return {"error": "MCP workflow streaming not yet fully implemented in unified endpoint. Use /mcp/start for now."}


# --- Get Workflow State ---
@router.get("/unified/state/{thread_id}")
def get_workflow_state(thread_id: str):
    """Get the current state of any workflow."""
    if thread_id not in run_configs:
        return {"error": "Thread ID not found"}
    
    workflow_type = run_configs[thread_id].get("workflow_type", "basic")
    config = {"configurable": {"thread_id": thread_id}}
    
    graphs = {
        "basic": basic_graph,
        "custom": custom_graph,
        "data_analysis": data_analysis_graph,
        "editable": editable_graph
    }
    
    if workflow_type not in graphs:
        return {"error": f"Unknown workflow type: {workflow_type}"}
    
    state = graphs[workflow_type].get_state(config)
    
    return {
        "thread_id": thread_id,
        "workflow_type": workflow_type,
        "state": state.values,
        "next_nodes": list(state.next) if state.next else []
    }


# --- Get Sentences (for editable workflow) ---
@router.get("/unified/sentences/{thread_id}")
def get_sentences(thread_id: str):
    """Get editable sentences for editable workflow."""
    if thread_id not in run_configs:
        return {"error": "Thread ID not found"}
    
    workflow_type = run_configs[thread_id].get("workflow_type")
    if workflow_type != "editable":
        return {"error": "This endpoint is only for editable workflow"}
    
    config = {"configurable": {"thread_id": thread_id}}
    state = editable_graph.get_state(config)
    
    if not state.values:
        return {"error": "Workflow state not found"}
    
    current_content = state.values.get("current_content", "")
    edited_sentences = state.values.get("edited_sentences", {})
    
    if not edited_sentences and current_content:
        from app.editable_workflow import create_sentence_map
        edited_sentences = create_sentence_map(current_content)
        editable_graph.update_state(config, {"edited_sentences": edited_sentences})
    
    return {
        "thread_id": thread_id,
        "sentences": edited_sentences,
        "current_content": current_content,
        "revision_count": state.values.get("revision_count", 0)
    }


# --- Visualization Endpoint ---
@router.get("/unified/visualization/{filename}")
async def get_visualization(filename: str):
    """Serve visualization images from data analysis."""
    from fastapi.responses import FileResponse
    
    viz_dir = os.path.join(uploads_dir, "visualizations")
    file_path = os.path.join(viz_dir, filename)
    
    if os.path.exists(file_path):
        return FileResponse(file_path)
    else:
        return {"error": "Visualization not found"}



