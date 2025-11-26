# Lesson 4: Custom Gen AI Workflow with HITL
# Advanced workflow demonstrating research → draft → review → finalize pattern
# Uses Server-Sent Events (SSE) for real-time streaming

from fastapi import APIRouter, Request
from uuid import uuid4
from app.models import StartRequest, GraphResponse, ResumeRequest
from app.custom_workflow import custom_graph
from sse_starlette.sse import EventSourceResponse
import json

router = APIRouter()

# In-memory storage for run configurations
run_configs = {}


@router.post("/custom/start", response_model=GraphResponse)
def create_custom_workflow(request: StartRequest):
    """
    Start a new custom workflow run.
    Creates a thread and initializes the workflow with the user's query.
    """
    thread_id = str(uuid4())
    
    run_configs[thread_id] = {
        "type": "start",
        "user_query": request.human_request
    }
    
    return GraphResponse(
        thread_id=thread_id,
        run_status="pending",
        assistant_response=None
    )


@router.post("/custom/resume", response_model=GraphResponse)
def resume_custom_workflow(request: ResumeRequest):
    """
    Resume a paused workflow after human review.
    Updates the state with approval status and optional feedback.
    """
    thread_id = request.thread_id
    
    if thread_id not in run_configs:
        # If thread_id not in run_configs, it might be from a previous session
        # We'll allow resuming if the graph state exists
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


@router.get("/custom/stream/{thread_id}")
async def stream_custom_workflow(request: Request, thread_id: str):
    """
    Stream the custom workflow execution using Server-Sent Events.
    Handles both initial runs and resumed runs after human feedback.
    """
    # Check if thread_id exists in our configurations
    if thread_id not in run_configs:
        return {"error": "Thread ID not found. You must first call /custom/start or /custom/resume"}
    
    # Get the stored configuration
    run_data = run_configs[thread_id]
    config = {"configurable": {"thread_id": thread_id}}
    
    input_state = None
    if run_data["type"] == "start":
        event_type = "start"
        input_state = {"user_query": run_data["user_query"]}
    else:
        event_type = "resume"
        
        # Update state with feedback/approval
        state_update = {"approval_status": run_data["review_action"]}
        if run_data["human_comment"] is not None:
            state_update["human_feedback"] = run_data["human_comment"]
        
        custom_graph.update_state(config, state_update)
        # For resume operations, we pass None as the input state
    
    async def event_generator():
        # Initial event with thread_id
        initial_data = json.dumps({"thread_id": thread_id})
        print(f"DEBUG: Sending initial {event_type} event with data: {initial_data}")
        
        yield {"event": event_type, "data": initial_data}
        
        try:
            print(f"DEBUG: Starting to stream custom workflow messages for thread_id={thread_id}")
            
            # Stream messages from the graph
            for msg, metadata in custom_graph.stream(input_state, config, stream_mode="messages"):
                if await request.is_disconnected():
                    print("DEBUG: Client disconnected, breaking stream loop")
                    break
                
                # Stream messages from specific nodes
                node_name = metadata.get('langgraph_node', '')
                if node_name in ['research', 'draft', 'finalize']:
                    # Include node information in the token data
                    token_data = json.dumps({
                        "content": msg.content,
                        "node": node_name
                    })
                    print(f"DEBUG: Sending token event from {node_name} with data: {token_data[:50]}...")
                    yield {"event": "token", "data": token_data}
            
            # After streaming completes, check if human feedback is needed
            state = custom_graph.get_state(config)
            if state.next and 'human_review' in state.next:
                # Extract draft content for display
                draft_content = state.values.get('draft_content', '')
                status_data = json.dumps({
                    "status": "user_feedback",
                    "draft_content": draft_content
                })
                print(f"DEBUG: Sending status event (feedback): {status_data[:100]}...")
                yield {"event": "status", "data": status_data}
            else:
                # Workflow finished - extract final output
                final_output = state.values.get('final_output', state.values.get('draft_content', ''))
                status_data = json.dumps({
                    "status": "finished",
                    "final_output": final_output
                })
                print(f"DEBUG: Sending status event (finished): {status_data[:100]}...")
                yield {"event": "status", "data": status_data}
            
            # Clean up the thread configuration after streaming is complete
            if thread_id in run_configs:
                print(f"DEBUG: Cleaning up thread_id={thread_id} from run_configs")
                del run_configs[thread_id]
                
        except Exception as e:
            print(f"DEBUG: Exception in event_generator: {str(e)}")
            import traceback
            traceback.print_exc()
            yield {"event": "error", "data": json.dumps({"error": str(e)})}
            
            # Clean up on error as well
            if thread_id in run_configs:
                print(f"DEBUG: Cleaning up thread_id={thread_id} from run_configs after error")
                del run_configs[thread_id]
    
    return EventSourceResponse(event_generator())

