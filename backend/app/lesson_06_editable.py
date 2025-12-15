# Lesson 6: Editable Content Workflow with Sentence-Level Editing
# Demonstrates human-in-the-loop editing where users can edit individual sentences
# Uses Server-Sent Events (SSE) for real-time streaming

from fastapi import APIRouter, Request
from uuid import uuid4
from app.models import StartRequest, GraphResponse
from app.editable_workflow import editable_graph, split_into_sentences, create_sentence_map
from sse_starlette.sse import EventSourceResponse
from pydantic import BaseModel
from typing import Optional, Dict
import json

router = APIRouter()

# In-memory storage for run configurations
run_configs = {}


# --- Request Models ---
class SentenceEditRequest(BaseModel):
    thread_id: str
    sentence_id: str
    edited_text: str


class SentenceFeedbackRequest(BaseModel):
    thread_id: str
    sentence_id: str
    feedback: str


class EditableResumeRequest(BaseModel):
    thread_id: str
    review_action: str  # "approved", "editing", "feedback"
    edited_sentences: Optional[Dict[str, str]] = None  # sentence_id -> edited_text
    sentence_feedback: Optional[Dict[str, str]] = None  # sentence_id -> feedback
    human_comment: Optional[str] = None


@router.post("/editable/start", response_model=GraphResponse)
def create_editable_workflow(request: StartRequest):
    """
    Start a new editable workflow run.
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


@router.post("/editable/edit-sentence")
def edit_sentence(request: SentenceEditRequest):
    """
    Edit a specific sentence in the current content.
    This allows sentence-level editing without regenerating the entire content.
    """
    thread_id = request.thread_id
    config = {"configurable": {"thread_id": thread_id}}
    
    # Get current state
    state = editable_graph.get_state(config)
    if not state.values:
        return {"error": "Thread ID not found or workflow not started"}
    
    # Update the edited_sentences in state
    edited_sentences = state.values.get("edited_sentences", {})
    if not edited_sentences:
        # Initialize from current_content if not already done
        current_content = state.values.get("current_content", "")
        edited_sentences = create_sentence_map(current_content)
    
    # Update the specific sentence
    edited_sentences[request.sentence_id] = request.edited_text
    
    # Update state
    editable_graph.update_state(config, {"edited_sentences": edited_sentences})
    
    return {
        "thread_id": thread_id,
        "sentence_id": request.sentence_id,
        "status": "updated",
        "message": f"Sentence {request.sentence_id} updated successfully"
    }


@router.post("/editable/feedback-sentence")
def feedback_sentence(request: SentenceFeedbackRequest):
    """
    Provide feedback on a specific sentence.
    This allows users to request improvements without directly editing.
    """
    thread_id = request.thread_id
    config = {"configurable": {"thread_id": thread_id}}
    
    # Get current state
    state = editable_graph.get_state(config)
    if not state.values:
        return {"error": "Thread ID not found or workflow not started"}
    
    # Update the sentence_feedback in state
    sentence_feedback = state.values.get("sentence_feedback", {})
    sentence_feedback[request.sentence_id] = request.feedback
    
    # Update state
    editable_graph.update_state(config, {"sentence_feedback": sentence_feedback})
    
    return {
        "thread_id": thread_id,
        "sentence_id": request.sentence_id,
        "status": "feedback_recorded",
        "message": f"Feedback recorded for sentence {request.sentence_id}"
    }


@router.get("/editable/sentences/{thread_id}")
def get_sentences(thread_id: str):
    """
    Get the current content split into editable sentences.
    Returns a map of sentence IDs to sentence text.
    """
    config = {"configurable": {"thread_id": thread_id}}
    
    # Get current state
    state = editable_graph.get_state(config)
    if not state.values:
        return {"error": "Thread ID not found or workflow not started"}
    
    current_content = state.values.get("current_content", "")
    edited_sentences = state.values.get("edited_sentences", {})
    
    if not edited_sentences and current_content:
        # Create sentence map if not exists
        edited_sentences = create_sentence_map(current_content)
        editable_graph.update_state(config, {"edited_sentences": edited_sentences})
    
    return {
        "thread_id": thread_id,
        "sentences": edited_sentences,
        "current_content": current_content,
        "revision_count": state.values.get("revision_count", 0)
    }


@router.post("/editable/resume", response_model=GraphResponse)
def resume_editable_workflow(request: EditableResumeRequest):
    """
    Resume a paused workflow after human editing.
    Updates the state with edits, feedback, and approval status.
    """
    thread_id = request.thread_id
    config = {"configurable": {"thread_id": thread_id}}
    
    # Prepare state update
    state_update = {"approval_status": request.review_action}
    
    if request.edited_sentences:
        state_update["edited_sentences"] = request.edited_sentences
    
    if request.sentence_feedback:
        state_update["sentence_feedback"] = request.sentence_feedback
    
    if request.human_comment:
        state_update["human_feedback"] = request.human_comment
        # If review_action is "feedback", ensure it's set correctly
        if request.review_action == "feedback":
            state_update["approval_status"] = "feedback"
    
    # Update state
    editable_graph.update_state(config, state_update)
    
    run_configs[thread_id] = {
        "type": "resume",
        "review_action": request.review_action,
        "edited_sentences": request.edited_sentences,
        "sentence_feedback": request.sentence_feedback,
        "human_comment": request.human_comment
    }
    
    return GraphResponse(
        thread_id=thread_id,
        run_status="pending",
        assistant_response=None
    )


@router.get("/editable/stream/{thread_id}")
async def stream_editable_workflow(request: Request, thread_id: str):
    """
    Stream the editable workflow execution using Server-Sent Events.
    Handles both initial runs and resumed runs after human editing.
    """
    # Check if thread_id exists in our configurations
    if thread_id not in run_configs:
        # Check if thread exists in graph state
        config = {"configurable": {"thread_id": thread_id}}
        state = editable_graph.get_state(config)
        if not state.values:
            return {"error": "Thread ID not found. You must first call /editable/start or /editable/resume"}
    
    # Get the stored configuration
    run_data = run_configs.get(thread_id, {})
    config = {"configurable": {"thread_id": thread_id}}
    
    input_state = None
    if run_data.get("type") == "start":
        event_type = "start"
        input_state = {"user_query": run_data["user_query"]}
    else:
        event_type = "resume"
        
        # Update state with edits/feedback/approval
        state_update = {"approval_status": run_data.get("review_action", "editing")}
        if run_data.get("edited_sentences"):
            state_update["edited_sentences"] = run_data["edited_sentences"]
        if run_data.get("sentence_feedback"):
            state_update["sentence_feedback"] = run_data["sentence_feedback"]
        if run_data.get("human_comment"):
            state_update["human_feedback"] = run_data["human_comment"]
        
        editable_graph.update_state(config, state_update)
        # For resume operations, we pass None as the input state
    
    async def event_generator():
        # Initial event with thread_id
        initial_data = json.dumps({"thread_id": thread_id})
        yield {"event": event_type, "data": initial_data}
        
        try:
            # Stream messages from the graph
            for msg, metadata in editable_graph.stream(input_state, config, stream_mode="messages"):
                if await request.is_disconnected():
                    break
                
                # Stream messages from specific nodes
                node_name = metadata.get('langgraph_node', '')
                if node_name in ['generate_initial', 'incorporate_edits', 'finalize']:
                    # Safely extract content from message
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
                        
                        # Include node information in the token data
                        token_data = json.dumps({
                            "content": content,
                            "node": node_name
                        }, ensure_ascii=False)
                        yield {"event": "token", "data": token_data}
                    except (AttributeError, TypeError, ValueError) as e:
                        # Try fallback
                        try:
                            content = str(msg) if msg else ''
                            token_data = json.dumps({
                                "content": content,
                                "node": node_name
                            }, ensure_ascii=False)
                            yield {"event": "token", "data": token_data}
                        except Exception:
                            continue
            
            # After streaming completes, check if human editing is needed
            state = editable_graph.get_state(config)
            if state.next and 'human_edit' in state.next:
                # Extract current content and sentences for editing
                current_content = state.values.get('current_content', '')
                edited_sentences = state.values.get('edited_sentences', {})
                
                status_data = json.dumps({
                    "status": "editing",
                    "current_content": current_content,
                    "sentences": edited_sentences,
                    "revision_count": state.values.get('revision_count', 0)
                })
                yield {"event": "status", "data": status_data}
            else:
                # Workflow finished - extract final output
                final_output = state.values.get('final_output', state.values.get('current_content', ''))
                status_data = json.dumps({
                    "status": "finished",
                    "final_output": final_output
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

