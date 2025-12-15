# Lesson 5: Data Analysis Workflow with CSV Support
# Advanced workflow for analyzing data files with code generation and visualization
# Supports interrupts at multiple stages and message-based interrupts

from fastapi import APIRouter, Request, UploadFile, File, Form
from uuid import uuid4
from app.models import StartRequest, GraphResponse, ResumeRequest
from app.data_analysis_workflow import data_analysis_graph, DataAnalysisWorkflowState, execute_code_safely
from sse_starlette.sse import EventSourceResponse
import json
import os
import shutil
from typing import Optional
from pydantic import BaseModel

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
                    # Safely extract content from message
                    try:
                        # Handle different message types and content formats
                        content = None
                        if hasattr(msg, 'content'):
                            content = msg.content
                        elif isinstance(msg, dict):
                            content = msg.get('content', '')
                        elif hasattr(msg, 'get'):
                            content = msg.get('content', '')
                        else:
                            content = str(msg) if msg else ''
                        
                        # Ensure content is a string and handle None/empty cases
                        if content is None:
                            content = ''
                        else:
                            content = str(content)
                        
                        token_data = json.dumps({
                            "content": content,
                            "node": node_name
                        }, ensure_ascii=False)
                        yield {"event": "token", "data": token_data}
                    except (AttributeError, TypeError, ValueError) as e:
                        print(f"DEBUG: Error processing message content: {str(e)}, msg type: {type(msg)}")
                        # Try to get string representation as fallback
                        try:
                            content = str(msg) if msg else ''
                            token_data = json.dumps({
                                "content": content,
                                "node": node_name
                            }, ensure_ascii=False)
                            yield {"event": "token", "data": token_data}
                        except Exception as fallback_error:
                            print(f"DEBUG: Fallback also failed: {str(fallback_error)}")
                            # Skip this message if we can't process it
                            continue
            
            # After streaming completes, check if human feedback is needed
            state = data_analysis_graph.get_state(config)
            
            # Check for interrupts at different stages
            if state.next:
                next_nodes = [node for node in state.next if isinstance(node, str)]
                
                if 'human_review' in next_nodes:
                    # Extract draft content for display
                    draft_content = state.values.get('generated_code', '')
                    visualization_path = state.values.get('visualization_path', '')
                    visualization_paths = state.values.get('visualization_paths', [])
                    
                    status_data = json.dumps({
                        "status": "user_feedback",
                        "draft_content": draft_content,
                        "code": draft_content,
                        "visualization_path": visualization_path,
                        "visualization_paths": visualization_paths,
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
                    visualization_paths = state.values.get('visualization_paths', [])
                    
                    status_data = json.dumps({
                        "status": "finished",
                        "final_output": final_output,
                        "visualization_path": visualization_path,
                        "visualization_paths": visualization_paths,
                        "code": state.values.get('generated_code', ''),
                        "analysis_plan": state.values.get('analysis_plan', '')
                    })
                    yield {"event": "status", "data": status_data}
            else:
                # Workflow finished
                final_output = state.values.get('final_report', state.values.get('generated_code', ''))
                visualization_path = state.values.get('visualization_path', '')
                visualization_paths = state.values.get('visualization_paths', [])
                
                status_data = json.dumps({
                    "status": "finished",
                    "final_output": final_output,
                    "visualization_path": visualization_path,
                    "visualization_paths": visualization_paths,
                    "code": state.values.get('generated_code', ''),
                    "analysis_plan": state.values.get('analysis_plan', '')
                })
                yield {"event": "status", "data": status_data}
            
            # Clean up the thread configuration after streaming is complete
            if thread_id in run_configs:
                del run_configs[thread_id]
                
        except Exception as e:
            error_msg = str(e) if e else "Unknown error occurred"
            print(f"DEBUG: Exception in event_generator: {error_msg}, type: {type(e)}")
            import traceback
            traceback.print_exc()
            try:
                # Safely serialize error message
                error_data = json.dumps({"error": error_msg}, ensure_ascii=False)
                yield {"event": "error", "data": error_data}
            except Exception as json_error:
                # If JSON serialization fails, send a simple error message
                print(f"DEBUG: Failed to serialize error to JSON: {str(json_error)}")
                try:
                    yield {"event": "error", "data": json.dumps({"error": "An error occurred during streaming"})}
                except:
                    # Last resort - just skip the error event
                    pass
            
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


class ExecuteCodeRequest(BaseModel):
    code: str
    file_path: Optional[str] = None
    fix_errors: bool = False  # If True, send errors to AI for fixing
    original_query: Optional[str] = None  # Original user query for context


@router.post("/data-analysis/execute-code")
async def execute_code(request: ExecuteCodeRequest):
    """
    Execute Python code on demand (like an online IDE).
    This allows users to run generated code independently of the workflow.
    If fix_errors is True and execution fails, the error is sent to AI for automatic fixing.
    """
    from app.data_analysis_workflow import model
    from langchain_core.messages import SystemMessage, HumanMessage
    
    try:
        result = execute_code_safely(request.code, request.file_path)
        
        # If execution failed and fix_errors is enabled, try to fix it
        if not result["success"] and request.fix_errors and result.get("error"):
            try:
                # Send error to AI for fixing
                system_message = SystemMessage(content="""
                You are a Python code fixer. A user tried to execute Python code for data analysis, but it failed with an error.
                Your task is to fix the code by:
                1. Understanding the error message
                2. Identifying the issue in the code
                3. Providing the corrected code
                4. Ensuring the code is executable and follows best practices
                
                Return ONLY the fixed Python code, wrapped in ```python code blocks.
                Do not include explanations, just the corrected code.
                """)
                
                user_message = HumanMessage(content=f"""
                Original User Query: {request.original_query or 'Data analysis'}
                
                Original Code (with error):
                ```python
                {request.code}
                ```
                
                Error Message:
                {result["error"]}
                
                Please fix the code and return only the corrected Python code.
                """)
                
                ai_response = model.invoke([system_message, user_message])
                
                # Extract fixed code
                fixed_code = ai_response.content
                if "```python" in fixed_code:
                    fixed_code = fixed_code.split("```python")[1].split("```")[0].strip()
                elif "```" in fixed_code:
                    fixed_code = fixed_code.split("```")[1].split("```")[0].strip()
                
                # Try executing the fixed code
                fixed_result = execute_code_safely(fixed_code, request.file_path)
                
                if fixed_result["success"]:
                    return {
                        "success": True,
                        "output": fixed_result["output"],
                        "error": None,
                        "fixed": True,
                        "original_error": result["error"],
                        "fixed_code": fixed_code
                    }
                else:
                    # Even the fixed code failed
                    return {
                        "success": False,
                        "output": None,
                        "error": f"Attempted to fix but still failed.\n\nOriginal Error: {result['error']}\n\nFixed Code Error: {fixed_result['error']}",
                        "fixed": True,
                        "fixed_code": fixed_code
                    }
            except Exception as fix_error:
                # Error fixing failed
                return {
                    "success": False,
                    "output": None,
                    "error": f"Original error: {result['error']}\n\nFailed to auto-fix: {str(fix_error)}",
                    "fixed": False
                }
        
        return result
    except Exception as e:
        return {
            "success": False,
            "output": None,
            "error": f"Error executing code: {str(e)}"
        }


