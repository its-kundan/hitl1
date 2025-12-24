from pydantic import BaseModel
from typing import Optional, List

class StartRequest(BaseModel):
    human_request: str

class ResumeRequest(BaseModel):
    thread_id: str
    review_action: str  # "approved" or "feedback"
    human_comment: Optional[str] = None
    edited_content: Optional[str] = None  # New: Allow user to directly edit the chunk
    updated_plan: Optional[List[str]] = None  # New: Allow user to update the plan
    sentence_feedback: Optional[List[dict]] = None  # New: Array of sentence-specific feedbacks with text and feedback

class ApproveRequest(BaseModel):
    thread_id: str
    approve_action: str  # "approved" or "rejected"

class GraphResponse(BaseModel):
    thread_id: str
    run_status: str
    assistant_response: Optional[str] = None
    chunks: List[str] = []         # New: Return mostly for non-streaming access
    current_chunk_index: int = 0   # New: Track progress