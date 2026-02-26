# Lesson 4: Custom Gen AI Workflow with HITL (Iterative Content Generator)
# Uses only OPENAI_API_KEY - no GROQ, Gemini, or other keys required.

from fastapi import APIRouter, Request, HTTPException
from uuid import uuid4
import os
import asyncio
from app.models import StartRequest, GraphResponse, ResumeRequest
from app.custom_workflow import custom_graph
from sse_starlette.sse import EventSourceResponse
import json

router = APIRouter()


def _run_custom_workflow_to_interrupt(input_state, config: dict) -> "tuple[dict, bool]":
    """Run workflow synchronously until interrupt or end. Returns (state_values, interrupted_at_review).
    input_state: dict for start (e.g. {"user_query": "..."}), None for resume.
    """
    try:
        custom_graph.invoke(input_state, config)
        state = custom_graph.get_state(config)
        values = state.values or {}
        interrupted = bool(state.next and "human_review" in state.next)
        return values, interrupted
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"_error": str(e)}, False


def _ensure_openai_key():
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY is required. Add it to backend/.env (e.g. OPENAI_API_KEY=sk-...)."
        )

# In-memory storage for run configurations
# In a real app, this would be in a database
run_configs = {}


@router.post("/custom/start", response_model=GraphResponse)
def create_custom_workflow(request: StartRequest):
    """Start a new custom workflow run. Requires only OPENAI_API_KEY."""
    _ensure_openai_key()
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
    """Resume a paused workflow after human review."""
    thread_id = request.thread_id
    config = {"configurable": {"thread_id": thread_id}}
    
    if thread_id not in run_configs:
         # Check if graph state actually exists, if so we can proceed
        try:
            state = custom_graph.get_state(config)
            if not state.values:
                 raise HTTPException(status_code=404, detail="Thread not found")
        except:
             # Just proceed and let the stream endpoint handle it or fail
             pass
    
    # Store request data to be applied in the stream endpoint
    # (Or apply immediately if we wanted, but keeping pattern consistent)
    run_configs[thread_id] = {
        "type": "resume",
        "review_action": request.review_action,
        "human_comment": request.human_comment,
        "edited_content": request.edited_content
    }
    
    return GraphResponse(
        thread_id=thread_id,
        run_status="pending",
        assistant_response=None
    )


@router.get("/custom/stream/{thread_id}")
async def stream_custom_workflow(request: Request, thread_id: str):
    """
    Stream the custom workflow execution.
    Handles 'start' logic and 'resume' logic (applying edits/feedback).
    Requires only OPENAI_API_KEY.
    """
    _ensure_openai_key()
    config = {"configurable": {"thread_id": thread_id}}
    
    # Determine mode
    run_data = run_configs.pop(thread_id, None)
    
    input_state = None
    event_type = "resume" # default
    
    if run_data:
        if run_data["type"] == "start":
            event_type = "start"
            input_state = {"user_query": run_data["user_query"]}
        
        elif run_data["type"] == "resume":
            event_type = "resume"
            
            current_state = custom_graph.get_state(config)
            if current_state.values:
                # 1. Update plan if provided
                if run_data.get("updated_plan"):
                    custom_graph.update_state(config, {"plan": run_data["updated_plan"]})
                    # Adjust current_section_index if plan was shortened
                    current_idx = current_state.values.get("current_section_index", 0)
                    new_plan_len = len(run_data["updated_plan"])
                    if current_idx >= new_plan_len:
                        custom_graph.update_state(config, {"current_section_index": max(0, new_plan_len - 1)})
                
                # 2. Apply Edits if any (store in state for use in generation)
                if run_data.get("edited_content"):
                    # Store edited content in state so generate_section_node can use it
                    custom_graph.update_state(config, {"edited_content": run_data["edited_content"]})
                
                # 3. Handle sentence-level feedback (now supports multiple feedbacks)
                if run_data.get("sentence_feedback"):
                    sentence_feedbacks = run_data["sentence_feedback"]
                    general_feedback = run_data.get("human_comment", "")
                    
                    # Check if feedbacks are already combined in frontend
                    if isinstance(sentence_feedbacks, list) and len(sentence_feedbacks) > 0:
                        # Check if already combined
                        if "Multiple Sentence Feedbacks" in general_feedback or "Sentence Feedbacks" in general_feedback:
                            # Already combined in frontend, use as is
                            pass
                        else:
                            # Combine all sentence feedbacks with general feedback
                            sentence_feedbacks_text = "\n\n".join([
                                f"Feedback {idx + 1}: Please improve this specific sentence: \"{fb.get('text', '')}\"\nFeedback: {fb.get('feedback', '')}"
                                for idx, fb in enumerate(sentence_feedbacks)
                            ])
                            
                            combined_feedback = f"IMPORTANT - Multiple Sentence Feedbacks:\n{sentence_feedbacks_text}\n\nMake sure to incorporate ALL of these feedbacks into the revised version."
                            
                            if general_feedback:
                                run_data["human_comment"] = f"{general_feedback}\n\n{combined_feedback}"
                            else:
                                run_data["human_comment"] = combined_feedback
                    elif isinstance(sentence_feedbacks, dict):
                        # Legacy single feedback format
                        sentence_text = sentence_feedbacks.get('text', '')
                        sentence_fb = sentence_feedbacks.get('feedback', '')
                        if sentence_text and sentence_fb:
                            if "Sentence feedback" not in general_feedback:
                                combined_feedback = f"IMPORTANT: Please improve this specific sentence: \"{sentence_text}\"\nFeedback: {sentence_fb}\nMake sure to incorporate this feedback into the revised version."
                                if general_feedback:
                                    run_data["human_comment"] = f"{general_feedback}\n\n{combined_feedback}"
                                else:
                                    run_data["human_comment"] = combined_feedback
            
            # 4. Update Feedback/Approval
            state_update = {
                "approval_status": run_data["review_action"],
                "human_feedback": run_data.get("human_comment")
            }
            custom_graph.update_state(config, state_update)
            # input_state remains None for resume
            
    else:
        # If no config in memory, assume it's a resume or reconnect
        # But for 'start', we need the query. We'll assume resume.
        pass

    async def event_generator():
        # Initial handshake
        initial_data = json.dumps({"thread_id": thread_id})
        yield {"event": event_type, "data": initial_data}

        try:
            # Run workflow in thread so sync LLM calls don't block the event loop.
            # This ensures we yield status to the client when the graph pauses at human_review or finishes.
            # For start: input_state = {"user_query": "..."}. For resume: input_state = None (continue from checkpoint).
            loop = asyncio.get_event_loop()
            values, interrupted_at_review = await loop.run_in_executor(
                None,
                lambda: _run_custom_workflow_to_interrupt(input_state, config),
            )

            if values.get("_error"):
                yield {"event": "error", "data": json.dumps({"error": values["_error"]})}
                return

            if interrupted_at_review:
                idx = values.get("current_section_index", 0)
                sections = values.get("generated_sections", [])
                current_chunk = sections[idx] if idx < len(sections) else ""
                status_data = json.dumps({
                    "status": "user_feedback",
                    "plan": values.get("plan", []),
                    "current_index": idx,
                    "generated_sections": sections,
                    "current_chunk": current_chunk
                })
                yield {"event": "status", "data": status_data}
            else:
                status_data = json.dumps({
                    "status": "finished",
                    "final_output": values.get("final_output", ""),
                    "plan": values.get("plan", []),
                    "generated_sections": values.get("generated_sections", [])
                })
                yield {"event": "status", "data": status_data}

        except Exception as e:
            import traceback
            traceback.print_exc()
            yield {"event": "error", "data": json.dumps({"error": str(e)})}

    return EventSourceResponse(event_generator())
