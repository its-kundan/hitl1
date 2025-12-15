from typing import Literal, Optional, List, Dict
from langgraph.graph import StateGraph, MessagesState, START, END
from langchain_community.chat_models import ChatOllama
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.checkpoint.memory import MemorySaver
from dotenv import load_dotenv
import os
import re

# Load environment variables before initializing the model
load_dotenv()

# --- Model Definition ---
# Using Ollama with llama2:latest locally
model = ChatOllama(model="llama2:latest", base_url="http://localhost:11434")


# --- Graph State Definition ---
class EditableWorkflowState(MessagesState):
    user_query: str
    initial_content: Optional[str] = None
    current_content: Optional[str] = None
    edited_sentences: Optional[Dict[str, str]] = None  # Maps sentence_id -> edited_text
    sentence_feedback: Optional[Dict[str, str]] = None  # Maps sentence_id -> feedback
    approval_status: Literal["pending", "approved", "editing", "feedback"] = "pending"
    human_feedback: Optional[str] = None  # General feedback for the entire content
    revision_count: int = 0
    final_output: Optional[str] = None


# --- Helper Functions ---
def split_into_sentences(text: str) -> List[str]:
    """Split text into sentences for editing."""
    # Simple sentence splitting - can be enhanced with NLTK or spaCy
    sentences = re.split(r'(?<=[.!?])\s+', text)
    return [s.strip() for s in sentences if s.strip()]


def create_sentence_map(content: str) -> Dict[str, str]:
    """Create a map of sentence IDs to sentence text."""
    sentences = split_into_sentences(content)
    return {f"sentence_{i}": sentence for i, sentence in enumerate(sentences)}


def reconstruct_content(sentence_map: Dict[str, str], original_order: List[str]) -> str:
    """Reconstruct content from sentence map, preserving order."""
    sentences = [sentence_map.get(sid, "") for sid in original_order if sid in sentence_map]
    return " ".join(sentences)


# --- Graph Nodes Definition ---

def generate_initial_content(state: EditableWorkflowState) -> EditableWorkflowState:
    """
    Node 1: Generate initial content based on user query.
    This content will be structured for sentence-level editing.
    """
    system_message = SystemMessage(content="""
    You are a content generator. Create well-structured, clear content based on the user's query.
    
    IMPORTANT: Write in complete, well-formed sentences. Each sentence should be:
    - Self-contained and clear
    - Properly punctuated
    - Ready for individual editing
    
    Format your response as natural, flowing text with proper sentence structure.
    """)
    
    user_message = HumanMessage(content=f"User request: {state['user_query']}")
    
    response = model.invoke([system_message, user_message])
    
    content = response.content
    sentence_map = create_sentence_map(content)
    sentence_order = list(sentence_map.keys())
    
    all_messages = state["messages"] + [response]
    
    return {
        **state,
        "messages": all_messages,
        "initial_content": content,
        "current_content": content,
        "edited_sentences": sentence_map,
        "sentence_feedback": {},
        "approval_status": "editing"  # Ready for human editing
    }


def incorporate_edits(state: EditableWorkflowState) -> EditableWorkflowState:
    """
    Node 2: Incorporate human edits and feedback into the content.
    This node processes sentence-level edits and feedback into the content.
    """
    current_content = state.get("current_content", "")
    edited_sentences = state.get("edited_sentences", {})
    sentence_feedback = state.get("sentence_feedback", {})
    human_feedback = state.get("human_feedback", "")  # General feedback
    initial_content = state.get("initial_content", current_content)
    
    # Get original sentence map for comparison
    original_sentences = create_sentence_map(initial_content)
    
    # Build context about what was edited
    edit_summary = []
    if edited_sentences:
        for sid, edited_text in edited_sentences.items():
            original = original_sentences.get(sid, "")
            if edited_text != original and original:
                edit_summary.append(f"Sentence {sid}: User edited from '{original[:80]}...' to '{edited_text[:80]}...'")
    
    feedback_summary = []
    if sentence_feedback:
        for sid, feedback in sentence_feedback.items():
            sentence_text = edited_sentences.get(sid, original_sentences.get(sid, ""))
            feedback_summary.append(f"Sentence {sid} ('{sentence_text[:60]}...'): User feedback - '{feedback}'")
    
    # Create system message based on what needs to be done
    if edit_summary or feedback_summary or human_feedback:
        general_feedback_text = f"\n\nGENERAL FEEDBACK:\n{human_feedback}" if human_feedback else ""
        
        system_message = SystemMessage(content=f"""
        You are a content editor revising content based on human edits and feedback.
        
        CURRENT CONTENT:
        {current_content}
        
        HUMAN EDITS:
        {chr(10).join(edit_summary) if edit_summary else "No direct edits"}
        
        SENTENCE-SPECIFIC FEEDBACK:
        {chr(10).join(feedback_summary) if feedback_summary else "No sentence-specific feedback"}
        {general_feedback_text}
        
        Your task:
        1. Incorporate ALL human edits exactly as specified
        2. Address ALL feedback provided (both sentence-specific and general)
        3. Update the surrounding context to ensure coherence
        4. Maintain the overall structure and flow
        5. Keep all unedited sentences as close to original as possible
        
        Generate the revised content that seamlessly integrates the edits and addresses all feedback.
        """)
        
        user_message = HumanMessage(content=f"Original query: {state['user_query']}")
        
        messages = [system_message, user_message]
    else:
        # No edits or feedback - just return current content
        return {
            **state,
            "approval_status": "editing"
        }
    
    response = model.invoke(messages)
    revised_content = response.content
    
    # Update sentence map with new content
    new_sentence_map = create_sentence_map(revised_content)
    
    all_messages = state["messages"] + [response]
    revision_count = state.get("revision_count", 0) + 1
    
    return {
        **state,
        "messages": all_messages,
        "current_content": revised_content,
        "edited_sentences": new_sentence_map,
        "sentence_feedback": {},  # Clear feedback after processing
        "revision_count": revision_count,
        "approval_status": "editing"  # Ready for more edits
    }


def human_edit_node(state: EditableWorkflowState):
    """
    Node 3: Human editing point (HITL).
    This is where the graph pauses for human sentence-level edits.
    The actual editing happens via API when the user provides edits.
    """
    pass


def finalize_content(state: EditableWorkflowState) -> EditableWorkflowState:
    """
    Node 4: Finalize the content after approval.
    This polishes the approved content into the final output.
    """
    current_content = state.get("current_content", "")
    
    system_message = SystemMessage(content="""
    You are a content editor finalizing approved content. The user has approved the current version.
    Your task is to make final polish improvements:
    - Ensure perfect grammar and punctuation
    - Improve flow and transitions
    - Enhance clarity where needed
    - Maintain the essence and structure of the approved content
    
    DO NOT significantly change the content. Focus on polishing what was approved.
    """)
    
    user_message = HumanMessage(content=f"Approved content to finalize:\n\n{current_content}")
    
    messages = [system_message, user_message]
    response = model.invoke(messages)
    
    all_messages = state["messages"] + [response]
    
    return {
        **state,
        "messages": all_messages,
        "final_output": response.content,
        "assistant_response": response.content  # For compatibility
    }


# --- Router Function ---
def edit_router(state: EditableWorkflowState) -> str:
    """
    Routes the workflow based on human editing decision.
    - If approved: proceed to finalize
    - If editing/feedback: go back to incorporate edits
    """
    if state["approval_status"] == "approved":
        return "finalize"
    else:
        return "incorporate_edits"  # Go back to incorporate edits


# --- Graph Construction ---
builder = StateGraph(EditableWorkflowState)

# Add all nodes
builder.add_node("generate_initial", generate_initial_content)
builder.add_node("incorporate_edits", incorporate_edits)
builder.add_node("human_edit", human_edit_node)
builder.add_node("finalize", finalize_content)

# Define the flow
builder.add_edge(START, "generate_initial")
builder.add_edge("generate_initial", "human_edit")
builder.add_conditional_edges(
    "human_edit",
    edit_router,
    {
        "finalize": "finalize",
        "incorporate_edits": "incorporate_edits"
    }
)
builder.add_edge("incorporate_edits", "human_edit")
builder.add_edge("finalize", END)

# Compile with interrupt before human_edit for HITL
memory = MemorySaver()
editable_graph = builder.compile(
    interrupt_before=["human_edit"],  # Pause here for human editing
    checkpointer=memory
)

# --- Exports ---
__all__ = ["editable_graph", "EditableWorkflowState", "split_into_sentences", "create_sentence_map"]

