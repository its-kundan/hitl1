# Lesson 5: Data Analysis Workflow with CSV Support
# Advanced workflow for analyzing data files with code generation and visualization
# Supports interrupts at multiple stages and message-based interrupts

from fastapi import APIRouter, Request, UploadFile, File, Form
from uuid import uuid4
from app.models import StartRequest, GraphResponse, ResumeRequest
from app.data_analysis_workflow import data_analysis_graph, DataAnalysisWorkflowState
from sse_starlette.sse import EventSourceResponse
import json
import os
import shutil
from typing import Optional

router = APIRouter()

# In-memory storage for run configurations
run_configs = {}
uploads_dir = os.path.join(os.path.dirname(__file__), "..", "uploads")
os.makedirs(uploads_dir, exist_ok=True)


@router.post("/data-analysis/upload")
async def upload_file(file: UploadFile = File(...)):
    """
    Upload a CSV file for analysis.
    Returns the file path and file name.
    """
    try:
        # Create uploads directory if it doesn't exist
        files_dir = os.path.join(uploads_dir, "files")
        os.makedirs(files_dir, exist_ok=True)
        
        # Generate unique filename
        file_id = str(uuid4())
        file_extension = os.path.splitext(file.filename)[1] or ".csv"
        saved_filename = f"{file_id}{file_extension}"
        file_path = os.path.join(files_dir, saved_filename)
        
        # Save the file
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


@router.post("/data-analysis/start", response_model=GraphResponse)
async def start_data_analysis(
    human_request: str = Form(...),
    file_path: Optional[str] = Form(None),
    file_name: Optional[str] = Form(None)
):
    """
    Start a new data analysis workflow run.
    Can accept either a file_path (from upload) or will work with user_query only.
    """
    thread_id = str(uuid4())
    
    run_configs[thread_id] = {
        "type": "start",
        "user_query": human_request,
        "file_path": file_path,
        "file_name": file_name
    }
    
    return GraphResponse(
        thread_id=thread_id,
        run_status="pending",
        assistant_response=None
    )


@router.post("/data-analysis/resume", response_model=GraphResponse)
def resume_data_analysis(request: ResumeRequest):
    """
    Resume a paused workflow after human review.
    Updates the state with approval status and optional feedback.
    Also supports message-based interrupts.
    """
    thread_id = request.thread_id
    
    if thread_id not in run_configs:
        # Allow resuming if the graph state exists
        pass
    
    run_configs[thread_id] = {
        "type": "resume",
        "review_action": request.review_action,
        "human_comment": request.human_comment
    }
    
    return GraphResponse(
        thread_id=thread_id,
        run_status="pending",
        assistant_response=None
    )


@router.post("/data-analysis/interrupt")
async def interrupt_analysis(
    thread_id: str = Form(...),
    message: str = Form(...)
):
    """
    Send a message to interrupt the workflow during generation.
    This allows human feedback to be injected while the workflow is running.
    """
    config = {"configurable": {"thread_id": thread_id}}
    
    # Get current state
    state = data_analysis_graph.get_state(config)
    
    if not state.values:
        return {"error": "No active workflow found for this thread_id"}
    
    # Update state with interrupt message
    state_update = {
        "interrupt_requested": True,
        "human_feedback": message,
        "approval_status": "feedback"
    }
    
    data_analysis_graph.update_state(config, state_update)
    
    return {
        "thread_id": thread_id,
        "message": "Interrupt message received. Workflow will incorporate feedback on next iteration.",
        "status": "interrupted"
    }


@router.get("/data-analysis/stream/{thread_id}")
async def stream_data_analysis(request: Request, thread_id: str):
    """
    Stream the data analysis workflow execution using Server-Sent Events.
    Handles both initial runs and resumed runs after human feedback.
    """
    # Check if thread_id exists in our configurations
    if thread_id not in run_configs:
        return {"error": "Thread ID not found. You must first call /data-analysis/start or /data-analysis/resume"}
    
    # Get the stored configuration
    run_data = run_configs[thread_id]
    config = {"configurable": {"thread_id": thread_id}}
    
    input_state = None
    if run_data["type"] == "start":
        event_type = "start"
        input_state = {
            "user_query": run_data["user_query"],
            "file_path": run_data.get("file_path"),
            "file_name": run_data.get("file_name")
        }
    else:
        event_type = "resume"
        
        # Update state with feedback/approval
        state_update = {"approval_status": run_data["review_action"]}
        if run_data.get("human_comment") is not None:
            state_update["human_feedback"] = run_data["human_comment"]
        
        data_analysis_graph.update_state(config, state_update)
    
    async def event_generator():
        # Initial event with thread_id
        initial_data = json.dumps({"thread_id": thread_id})
        yield {"event": event_type, "data": initial_data}
        
        try:
            # Stream messages from the graph
            for msg, metadata in data_analysis_graph.stream(input_state, config, stream_mode="messages"):
                if await request.is_disconnected():
                    break
                
                # Stream messages from specific nodes
                node_name = metadata.get('langgraph_node', '')
                if node_name in ['data_exploration', 'analysis_planning', 'code_generation', 
                                'code_execution', 'visualization_generation', 'finalize']:
                    token_data = json.dumps({
                        "content": msg.content,
                        "node": node_name
                    })
                    yield {"event": "token", "data": token_data}
            
            # After streaming completes, check if human feedback is needed
            state = data_analysis_graph.get_state(config)
            
            # Check for interrupts at different stages
            if state.next:
                next_nodes = [node for node in state.next if isinstance(node, str)]
                
                if 'human_review' in next_nodes:
                    # Extract draft content for display
                    draft_content = state.values.get('generated_code', '')
                    visualization_path = state.values.get('visualization_path', '')
                    
                    status_data = json.dumps({
                        "status": "user_feedback",
                        "draft_content": draft_content,
                        "code": draft_content,
                        "visualization_path": visualization_path,
                        "current_stage": state.values.get('current_stage', 'human_review')
                    })
                    yield {"event": "status", "data": status_data}
                elif 'code_generation' in next_nodes:
                    # Interrupt at code generation stage
                    status_data = json.dumps({
                        "status": "code_review",
                        "analysis_plan": state.values.get('analysis_plan', ''),
                        "current_stage": "code_generation"
                    })
                    yield {"event": "status", "data": status_data}
                else:
                    # Workflow finished
                    final_output = state.values.get('final_report', state.values.get('generated_code', ''))
                    visualization_path = state.values.get('visualization_path', '')
                    
                    status_data = json.dumps({
                        "status": "finished",
                        "final_output": final_output,
                        "visualization_path": visualization_path,
                        "code": state.values.get('generated_code', ''),
                        "analysis_plan": state.values.get('analysis_plan', '')
                    })
                    yield {"event": "status", "data": status_data}
            else:
                # Workflow finished
                final_output = state.values.get('final_report', state.values.get('generated_code', ''))
                visualization_path = state.values.get('visualization_path', '')
                
                status_data = json.dumps({
                    "status": "finished",
                    "final_output": final_output,
                    "visualization_path": visualization_path,
                    "code": state.values.get('generated_code', ''),
                    "analysis_plan": state.values.get('analysis_plan', '')
                })
                yield {"event": "status", "data": status_data}
            
            # Clean up the thread configuration after streaming is complete
            if thread_id in run_configs:
                del run_configs[thread_id]
                
        except Exception as e:
            import traceback
            traceback.print_exc()
            yield {"event": "error", "data": json.dumps({"error": str(e)})}
            
            # Clean up on error as well
            if thread_id in run_configs:
                del run_configs[thread_id]
    
    return EventSourceResponse(event_generator())


@router.get("/data-analysis/visualization/{filename}")
async def get_visualization(filename: str):
    """
    Serve visualization images.
    """
    from fastapi.responses import FileResponse
    
    viz_dir = os.path.join(uploads_dir, "visualizations")
    file_path = os.path.join(viz_dir, filename)
    
    if os.path.exists(file_path):
        return FileResponse(file_path)
    else:
        return {"error": "Visualization not found"}

