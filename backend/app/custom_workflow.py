from typing import Literal, Optional
from langgraph.graph import StateGraph, MessagesState, START, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.checkpoint.memory import MemorySaver
from dotenv import load_dotenv
import os

# Load environment variables before initializing the model
load_dotenv()

# --- Model Definition ---
# OpenAI API key configured in .env file
model = ChatOpenAI(model="gpt-4o-mini", api_key=os.getenv("OPENAI_API_KEY"))


# --- Graph State Definition ---
class CustomWorkflowState(MessagesState):
    user_query: str
    research_results: Optional[str] = None
    draft_content: Optional[str] = None
    human_feedback: Optional[str] = None
    approval_status: Literal["pending", "approved", "feedback"] = "pending"
    final_output: Optional[str] = None
    revision_count: int = 0


# --- Graph Nodes Definition ---

def research_node(state: CustomWorkflowState) -> CustomWorkflowState:
    """
    Node 1: Research and gather information about the user's query.
    This demonstrates how AI can gather context before creating content.
    """
    system_message = SystemMessage(content="""
    You are a research assistant. Your task is to provide comprehensive, 
    well-structured research on the given topic. Include key points, 
    important facts, and relevant context that would be useful for creating 
    high-quality content on this topic.
    
    Format your research in a clear, organized manner that can be easily 
    used as a foundation for content creation.
    """)
    
    user_message = HumanMessage(content=f"Research topic: {state['user_query']}")
    
    response = model.invoke([system_message, user_message])
    
    all_messages = state["messages"] + [response]
    
    return {
        **state,
        "messages": all_messages,
        "research_results": response.content
    }


def draft_node(state: CustomWorkflowState) -> CustomWorkflowState:
    """
    Node 2: Create a draft based on research and user query.
    This node incorporates feedback if the user requested revisions.
    """
    status = state.get("approval_status", "pending")
    
    if status == "feedback" and state.get("human_feedback"):
        # Incorporate human feedback into the draft
        system_message = SystemMessage(content=f"""
        You are a content creator revising your previous draft based on human feedback.
        
        FEEDBACK FROM HUMAN: "{state['human_feedback']}"
        
        Carefully incorporate this feedback into your content. Address all comments, 
        corrections, or suggestions. Ensure your revised draft fully integrates 
        the feedback while maintaining quality and coherence.
        
        DO NOT repeat the feedback verbatim in your response.
        """)
        
        research_msg = HumanMessage(content=f"Research context: {state.get('research_results', 'No research available')}")
        draft_msg = HumanMessage(content=f"Previous draft: {state.get('draft_content', 'No previous draft')}")
        feedback_msg = HumanMessage(content=f"User query: {state['user_query']}")
        
        messages = [system_message, research_msg, draft_msg, feedback_msg]
        all_messages = state["messages"]
        
    else:
        # Create initial draft
        system_message = SystemMessage(content="""
        You are a professional content creator. Based on the research provided 
        and the user's query, create a well-structured, engaging draft. 
        
        Your draft should:
        - Be clear and well-organized
        - Address the user's query comprehensively
        - Use the research as a foundation but write in your own style
        - Be ready for human review
        
        Do not reference any previous feedback at this stage.
        """)
        
        research_msg = HumanMessage(content=f"Research: {state.get('research_results', 'No research available')}")
        query_msg = HumanMessage(content=f"User query: {state['user_query']}")
        
        messages = [system_message, research_msg, query_msg]
        all_messages = state["messages"]
    
    response = model.invoke(messages)
    all_messages = all_messages + [response]
    
    revision_count = state.get("revision_count", 0)
    if status == "feedback":
        revision_count += 1
    
    return {
        **state,
        "messages": all_messages,
        "draft_content": response.content,
        "revision_count": revision_count
    }


def human_review_node(state: CustomWorkflowState):
    """
    Node 3: Human review point (HITL).
    This is where the graph pauses for human input.
    The actual review happens via API when the user provides feedback.
    """
    pass


def finalize_node(state: CustomWorkflowState) -> CustomWorkflowState:
    """
    Node 4: Finalize the content after approval.
    This polishes the approved draft into the final output.
    """
    system_message = SystemMessage(content="""
    You are a content editor. The user has approved the draft. Your task is to 
    carefully review and polish the approved content, making final improvements 
    to clarity, tone, and completeness.
    
    Ensure the response is:
    - Polished and professional
    - Ready for final delivery
    - Maintains the essence of the approved draft
    - Has improved flow and readability
    
    DO NOT significantly expand or change the content. Focus on polishing 
    the approved draft that was just reviewed.
    """)
    
    user_message = HumanMessage(content=f"Original query: {state['user_query']}")
    draft_message = HumanMessage(content=f"Approved draft to finalize: {state.get('draft_content', 'No draft available')}")
    
    messages = [system_message, user_message, draft_message]
    response = model.invoke(messages)
    
    all_messages = state["messages"] + [response]
    
    return {
        **state,
        "messages": all_messages,
        "final_output": response.content,
        "assistant_response": response.content  # For compatibility with existing response models
    }


# --- Router Function ---
def review_router(state: CustomWorkflowState) -> str:
    """
    Routes the workflow based on human review decision.
    - If approved: proceed to finalize
    - If feedback provided: go back to draft with feedback
    """
    if state["approval_status"] == "approved":
        return "finalize"
    else:
        return "draft"  # Go back to draft with feedback


# --- Graph Construction ---
builder = StateGraph(CustomWorkflowState)

# Add all nodes
builder.add_node("research", research_node)
builder.add_node("draft", draft_node)
builder.add_node("human_review", human_review_node)
builder.add_node("finalize", finalize_node)

# Define the flow
builder.add_edge(START, "research")
builder.add_edge("research", "draft")
builder.add_edge("draft", "human_review")
builder.add_conditional_edges(
    "human_review",
    review_router,
    {
        "finalize": "finalize",
        "draft": "draft"
    }
)
builder.add_edge("finalize", END)

# Compile with interrupt before human_review for HITL
memory = MemorySaver()
custom_graph = builder.compile(
    interrupt_before=["human_review"],  # Pause here for human input
    checkpointer=memory
)

# --- Exports ---
__all__ = ["custom_graph", "CustomWorkflowState"]




