from typing import Literal, Optional, List
from langgraph.graph import StateGraph, MessagesState, START, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.checkpoint.memory import MemorySaver
from dotenv import load_dotenv
import os
import json

# Load environment variables
load_dotenv()

# --- Model Definition ---
model = ChatOpenAI(model="gpt-4o-mini", api_key=os.getenv("OPENAI_API_KEY"))


# --- Graph State Definition ---
class CustomWorkflowState(MessagesState):
    user_query: str
    research_results: Optional[str] = None
    
    # Planning & Iteration State
    plan: List[str] = []             # List of section titles/topics
    current_section_index: int = 0
    generated_sections: List[str] = [] # The content for each section
    
    # Feedback & Interaction State
    human_feedback: Optional[str] = None
    approval_status: Literal["pending", "approved", "feedback"] = "pending"
    final_output: Optional[str] = None
    
    revision_count: int = 0


# --- Graph Nodes Definition ---

def research_node(state: CustomWorkflowState) -> CustomWorkflowState:
    """Node 1: Gather context."""
    system_message = SystemMessage(content="""
    You are a research assistant. Provide clear, key information about the topic.
    Format it as a concise summary.
    """)
    response = model.invoke([system_message, HumanMessage(content=state['user_query'])])
    
    return {
        "research_results": response.content,
        "messages": [response]
    }

def plan_node(state: CustomWorkflowState) -> CustomWorkflowState:
    """Node 2: Create a writing plan (sections)."""
    system_message = SystemMessage(content="""
    You are a content strategist. Return a JSON list of section titles for the user's request.
    Example: ["Introduction", "Benefits", "Conclusion"]
    Return ONLY valid JSON.
    """)
    
    user_msg = HumanMessage(content=f"Query: {state['user_query']}\nResearch Summary: {state.get('research_results', '')[:500]}")
    
    response = model.invoke([system_message, user_msg])
    
    try:
        # Simple cleaning to ensure we parse the array
        content = response.content.replace("```json", "").replace("```", "").strip()
        plan = json.loads(content)
        if not isinstance(plan, list):
            plan = ["General Overview"] # Fallback
    except:
        plan = ["Content Generation"] # Fallback
        
    return {
        "plan": plan,
        "current_section_index": 0,
        "generated_sections": [],
        "messages": [response]
    }

def generate_section_node(state: CustomWorkflowState) -> CustomWorkflowState:
    """Node 3: Generate or revise a specific section."""
    plan = state["plan"]
    idx = state["current_section_index"]
    current_topic = plan[idx] if idx < len(plan) else "Final Summary"
    
    # Check if we are revising based on feedback
    if state.get("approval_status") == "feedback" and state.get("human_feedback"):
        # Revision Mode
        prompt = f"""
        You are revising the section "{current_topic}".
        
        FEEDBACK: {state['human_feedback']}
        
        Previous draft:
        {state['generated_sections'][idx] if idx < len(state['generated_sections']) else ""}
        
        Rewrite this section incorporating the feedback.
        """
    else:
        # Generation Mode
        previous_content = "\n\n".join(state["generated_sections"])
        prompt = f"""
        You are writing the section "{current_topic}" (Section {idx + 1}/{len(plan)}).
        
        Context so far:
        {previous_content}
        
        Write ONLY the content for "{current_topic}". Do not repeat previous sections.
        """
    
    response = model.invoke([SystemMessage(content="You are a helpful content writer."), HumanMessage(content=prompt)])
    
    # Update generated_sections
    sections = list(state["generated_sections"])
    if idx < len(sections):
        sections[idx] = response.content # Replace existing (revision)
    else:
        sections.append(response.content) # Append new
        
    return {
        "generated_sections": sections,
        "draft_content": response.content, # For potential UI display compatibility
        "messages": [response]
    }

def human_review_node(state: CustomWorkflowState):
    """Wait for human input."""
    # This node doesn't do anything, it's just a pause point.
    pass

def finalize_node(state: CustomWorkflowState) -> CustomWorkflowState:
    """Compile final result."""
    final_text = "\n\n".join(state["generated_sections"])
    return {
        "final_output": final_text,
        "assistant_response": final_text  # For compatibility
    }

# --- Router ---
def review_router(state: CustomWorkflowState) -> str:
    status = state.get("approval_status", "pending")
    
    if status == "approved":
        # Check if there are more sections
        if state["current_section_index"] < len(state["plan"]) - 1:
            return "next_section"
        else:
            return "finalize"
    elif status == "feedback":
        return "revise"
    else:
        # Should technically not happen if paused correctly, but default to repeat
        return "revise"

def update_section_index(state: CustomWorkflowState) -> CustomWorkflowState:
    """Helper to increment index after approval."""
    return {
        "current_section_index": state["current_section_index"] + 1,
        "approval_status": "pending", # Reset status for next chunk
        "human_feedback": None
    }

# --- Graph Construction ---
builder = StateGraph(CustomWorkflowState)

builder.add_node("research", research_node)
builder.add_node("plan", plan_node)
builder.add_node("generate_section", generate_section_node)
builder.add_node("update_index", update_section_index)
builder.add_node("human_review", human_review_node)
builder.add_node("finalize", finalize_node)

# Flow
builder.add_edge(START, "research")
builder.add_edge("research", "plan")
builder.add_edge("plan", "generate_section")
builder.add_edge("generate_section", "human_review")

builder.add_conditional_edges(
    "human_review",
    review_router,
    {
        "next_section": "update_index",
        "finalize": "finalize",
        "revise": "generate_section"
    }
)

builder.add_edge("update_index", "generate_section")
builder.add_edge("finalize", END)

memory = MemorySaver()
custom_graph = builder.compile(
    interrupt_before=["human_review"],
    checkpointer=memory
)
