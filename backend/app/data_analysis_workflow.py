from typing import Literal, Optional, Dict, Any
from langgraph.graph import StateGraph, MessagesState, START, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from langgraph.checkpoint.memory import MemorySaver
from dotenv import load_dotenv
import os
import pandas as pd
import json
import base64
import io
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime

# Load environment variables before initializing the model
load_dotenv()

# --- Model Definition ---
model = ChatOpenAI(model="gpt-4o-mini", api_key=os.getenv("OPENAI_API_KEY"), temperature=0.7)

# --- Graph State Definition ---
class DataAnalysisWorkflowState(MessagesState):
    user_query: str
    file_path: Optional[str] = None
    file_name: Optional[str] = None
    data_summary: Optional[str] = None
    data_preview: Optional[str] = None
    analysis_plan: Optional[str] = None
    generated_code: Optional[str] = None
    code_execution_results: Optional[str] = None
    visualization_code: Optional[str] = None
    visualization_path: Optional[str] = None
    human_feedback: Optional[str] = None
    approval_status: Literal["pending", "approved", "feedback"] = "pending"
    final_report: Optional[str] = None
    revision_count: int = 0
    interrupt_requested: bool = False  # For message-based interrupts
    current_stage: Optional[str] = None


# --- Utility Functions ---
def load_dataframe(file_path: str) -> pd.DataFrame:
    """Load CSV file into pandas DataFrame."""
    try:
        df = pd.read_csv(file_path)
        return df
    except Exception as e:
        raise Exception(f"Error loading CSV file: {str(e)}")


def generate_data_summary(df: pd.DataFrame) -> str:
    """Generate a comprehensive summary of the dataset."""
    summary = []
    summary.append(f"Dataset Shape: {df.shape[0]} rows × {df.shape[1]} columns\n")
    summary.append(f"Columns: {', '.join(df.columns.tolist())}\n")
    summary.append("\n--- Data Types ---\n")
    summary.append(str(df.dtypes))
    summary.append("\n\n--- Missing Values ---\n")
    missing = df.isnull().sum()
    if missing.sum() > 0:
        summary.append(str(missing[missing > 0]))
    else:
        summary.append("No missing values found.")
    summary.append("\n\n--- Basic Statistics ---\n")
    summary.append(str(df.describe()))
    summary.append("\n\n--- First Few Rows ---\n")
    summary.append(str(df.head(10)))
    return "\n".join(summary)


def save_visualization(fig, filename: str) -> str:
    """Save matplotlib figure to file and return path."""
    uploads_dir = os.path.join(os.path.dirname(__file__), "..", "uploads", "visualizations")
    os.makedirs(uploads_dir, exist_ok=True)
    filepath = os.path.join(uploads_dir, filename)
    fig.savefig(filepath, dpi=150, bbox_inches='tight')
    plt.close(fig)
    return filepath


# --- Graph Nodes Definition ---

def data_exploration_node(state: DataAnalysisWorkflowState) -> DataAnalysisWorkflowState:
    """
    Node 1: Load and explore the uploaded data file.
    """
    if not state.get("file_path"):
        return {
            **state,
            "data_summary": "No file provided. Please upload a CSV file.",
            "current_stage": "data_exploration"
        }
    
    try:
        df = load_dataframe(state["file_path"])
        data_summary = generate_data_summary(df)
        data_preview = df.head(20).to_string()
        
        system_message = SystemMessage(content="""
        You are a data analyst. Analyze the provided dataset summary and create a comprehensive 
        data exploration report. Identify:
        - Key features and their types
        - Potential insights or patterns
        - Data quality issues
        - Interesting relationships between variables
        - Recommendations for analysis
        
        Format your response in a clear, structured manner.
        """)
        
        user_message = HumanMessage(content=f"""
        Dataset: {state.get('file_name', 'Unknown')}
        
        Data Summary:
        {data_summary}
        
        First 20 rows:
        {data_preview}
        
        Please provide a comprehensive data exploration report.
        """)
        
        response = model.invoke([system_message, user_message])
        
        all_messages = state["messages"] + [response]
        
        return {
            **state,
            "messages": all_messages,
            "data_summary": response.content,
            "data_preview": data_preview,
            "current_stage": "data_exploration"
        }
    except Exception as e:
        error_msg = f"Error during data exploration: {str(e)}"
        return {
            **state,
            "data_summary": error_msg,
            "current_stage": "data_exploration"
        }


def generate_data_preview(df: pd.DataFrame) -> str:
    """Generate a text preview of the dataset."""
    preview = []
    preview.append(f"Shape: {df.shape[0]} rows, {df.shape[1]} columns")
    preview.append(f"\nColumns: {', '.join(df.columns.tolist())}")
    preview.append(f"\n\nData Types:\n{df.dtypes.to_string()}")
    preview.append(f"\n\nMissing Values:\n{df.isnull().sum().to_string()}")
    preview.append(f"\n\nBasic Statistics:\n{df.describe().to_string()}")
    return "\n".join(preview)


def analysis_planning_node(state: DataAnalysisWorkflowState) -> DataAnalysisWorkflowState:
    """
    Node 2: Create an analysis plan based on the data exploration.
    """
    system_message = SystemMessage(content="""
    You are a data science consultant. Based on the data exploration report and user's query,
    create a detailed analysis plan. The plan should include:
    
    1. Analysis objectives
    2. Key questions to answer
    3. Specific analyses to perform (statistical tests, correlations, trends, etc.)
    4. Visualizations needed
    5. Expected insights
    
    Be specific and actionable. Consider the type of data (stock market, car prices, demographics, etc.)
    and tailor the analysis accordingly.
    """)
    
    user_message = HumanMessage(content=f"""
    User Query: {state['user_query']}
    
    Data Summary:
    {state.get('data_summary', 'No summary available')}
    
    Create a detailed analysis plan for this dataset.
    """)
    
    response = model.invoke([system_message, user_message])
    all_messages = state["messages"] + [response]
    
    return {
        **state,
        "messages": all_messages,
        "analysis_plan": response.content,
        "current_stage": "analysis_planning"
    }


def code_generation_node(state: DataAnalysisWorkflowState) -> DataAnalysisWorkflowState:
    """
    Node 3: Generate Python code for data analysis.
    This is where we can interrupt for human feedback.
    """
    status = state.get("approval_status", "pending")
    
    if status == "feedback" and state.get("human_feedback"):
        # Incorporate human feedback into code generation
        system_message = SystemMessage(content=f"""
        You are a Python data analyst. Revise your code based on human feedback.
        
        FEEDBACK FROM HUMAN: "{state['human_feedback']}"
        
        Previous analysis plan:
        {state.get('analysis_plan', 'No plan available')}
        
        Generate updated Python code that addresses the feedback. The code should:
        - Load the CSV file from: {state.get('file_path', 'path/to/file.csv')}
        - Perform the requested analyses
        - Be well-commented and executable
        - Use pandas, matplotlib, seaborn as needed
        
        Return ONLY the Python code, wrapped in ```python code blocks.
        """)
    else:
        # Generate initial code
        system_message = SystemMessage(content=f"""
        You are a Python data analyst. Generate comprehensive analysis code based on the plan.
        
        The code should:
        - Load the CSV file from: {state.get('file_path', 'path/to/file.csv')}
        - Perform all analyses outlined in the plan
        - Include data cleaning if needed
        - Generate statistical summaries
        - Be well-commented and executable
        - Use pandas, matplotlib, seaborn as needed
        
        Return ONLY the Python code, wrapped in ```python code blocks.
        """)
    
    analysis_plan_msg = HumanMessage(content=f"Analysis Plan:\n{state.get('analysis_plan', 'No plan available')}")
    data_summary_msg = HumanMessage(content=f"Data Summary:\n{state.get('data_summary', 'No summary available')}")
    query_msg = HumanMessage(content=f"User Query: {state['user_query']}")
    
    messages = [system_message, analysis_plan_msg, data_summary_msg, query_msg]
    response = model.invoke(messages)
    all_messages = state["messages"] + [response]
    
    # Extract code from markdown code blocks
    code_content = response.content
    if "```python" in code_content:
        code_content = code_content.split("```python")[1].split("```")[0].strip()
    elif "```" in code_content:
        code_content = code_content.split("```")[1].split("```")[0].strip()
    
    revision_count = state.get("revision_count", 0)
    if status == "feedback":
        revision_count += 1
    
    return {
        **state,
        "messages": all_messages,
        "generated_code": code_content,
        "revision_count": revision_count,
        "current_stage": "code_generation"
    }


def code_execution_node(state: DataAnalysisWorkflowState) -> DataAnalysisWorkflowState:
    """
    Node 4: Execute the generated code and capture results.
    """
    code = state.get("generated_code", "")
    if not code:
        return {
            **state,
            "code_execution_results": "No code to execute.",
            "current_stage": "code_execution"
        }
    
    try:
        # Create a safe execution environment
        exec_globals = {
            'pd': pd,
            'plt': plt,
            'sns': sns,
            'np': __import__('numpy'),
            'os': os,
            'json': json,
            'df': None  # Will be set by the code
        }
        
        # Load the dataframe first
        if state.get("file_path"):
            exec_globals['df'] = load_dataframe(state["file_path"])
        
        # Execute the code
        exec(code, exec_globals)
        
        # Try to capture any printed output or results
        results = []
        results.append("Code executed successfully.")
        
        # Check if any variables were created that might be useful
        if 'df' in exec_globals and exec_globals['df'] is not None:
            results.append(f"\nDataFrame shape after execution: {exec_globals['df'].shape}")
        
        execution_results = "\n".join(results)
        
    except Exception as e:
        execution_results = f"Error executing code: {str(e)}\n\nPlease review the code and fix any issues."
    
    return {
        **state,
        "code_execution_results": execution_results,
        "current_stage": "code_execution"
    }


def visualization_generation_node(state: DataAnalysisWorkflowState) -> DataAnalysisWorkflowState:
    """
    Node 5: Generate visualization code and create plots.
    """
    system_message = SystemMessage(content="""
    You are a data visualization expert. Generate Python code to create insightful visualizations
    based on the analysis results and user query.
    
    The code should:
    - Load the CSV file from the provided path
    - Create multiple relevant visualizations (plots, charts, graphs)
    - Use matplotlib and seaborn
    - Save visualizations to files
    - Be appropriate for the data type (stock market, car prices, demographics, etc.)
    
    Return ONLY the Python code, wrapped in ```python code blocks.
    """)
    
    user_message = HumanMessage(content=f"""
    User Query: {state['user_query']}
    
    Data Summary:
    {state.get('data_summary', 'No summary available')}
    
    Analysis Plan:
    {state.get('analysis_plan', 'No plan available')}
    
    Code Execution Results:
    {state.get('code_execution_results', 'No results available')}
    
    File Path: {state.get('file_path', 'path/to/file.csv')}
    
    Generate visualization code that creates meaningful plots for this dataset.
    """)
    
    response = model.invoke([system_message, user_message])
    all_messages = state["messages"] + [response]
    
    # Extract code from markdown
    viz_code = response.content
    if "```python" in viz_code:
        viz_code = viz_code.split("```python")[1].split("```")[0].strip()
    elif "```" in viz_code:
        viz_code = viz_code.split("```")[1].split("```")[0].strip()
    
        # Execute visualization code
        viz_path = None
        try:
            exec_globals = {
                'pd': pd,
                'plt': plt,
                'sns': sns,
                'np': __import__('numpy'),
                'save_visualization': save_visualization,
                'datetime': datetime,
                'os': os
            }
            
            if state.get("file_path"):
                exec_globals['df'] = load_dataframe(state["file_path"])
            
            # Add code to save visualizations
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"viz_{timestamp}.png"
            full_save_path = os.path.join(
                os.path.dirname(__file__), "..", "uploads", "visualizations", 
                filename
            )
            exec_globals['save_path'] = full_save_path
            
            # Execute visualization code
            exec(viz_code, exec_globals)
            
            # Try to find saved visualization
            if os.path.exists(full_save_path):
                # Return relative path for serving
                viz_path = filename
            else:
                # If code didn't save, save the current figure
                fig = plt.gcf()
                if fig.get_axes():
                    viz_path = save_visualization(fig, filename)
                    # Extract just the filename
                    if viz_path:
                        viz_path = os.path.basename(viz_path)
        
        except Exception as e:
            import traceback
            error_trace = traceback.format_exc()
            viz_code += f"\n\n# Error during visualization: {str(e)}\n{error_trace}"
    
    return {
        **state,
        "messages": all_messages,
        "visualization_code": viz_code,
        "visualization_path": viz_path,
        "current_stage": "visualization_generation"
    }


def human_review_node(state: DataAnalysisWorkflowState):
    """
    Node 6: Human review point (HITL).
    This is where the graph pauses for human input.
    """
    pass


def finalize_node(state: DataAnalysisWorkflowState) -> DataAnalysisWorkflowState:
    """
    Node 7: Create final comprehensive report.
    """
    system_message = SystemMessage(content="""
    You are a data science report writer. Create a comprehensive final report that includes:
    
    1. Executive Summary
    2. Data Overview
    3. Key Findings and Insights
    4. Analysis Results
    5. Visualizations Description
    6. Conclusions and Recommendations
    
    Make it professional, clear, and actionable. Include specific numbers and insights from the analysis.
    """)
    
    user_message = HumanMessage(content=f"""
    User Query: {state['user_query']}
    
    Data Summary:
    {state.get('data_summary', 'No summary available')}
    
    Analysis Plan:
    {state.get('analysis_plan', 'No plan available')}
    
    Generated Code:
    {state.get('generated_code', 'No code available')}
    
    Code Execution Results:
    {state.get('code_execution_results', 'No results available')}
    
    Visualization Code:
    {state.get('visualization_code', 'No visualization code available')}
    
    Create a comprehensive final report.
    """)
    
    messages = [system_message, user_message]
    response = model.invoke(messages)
    all_messages = state["messages"] + [response]
    
    return {
        **state,
        "messages": all_messages,
        "final_report": response.content,
        "assistant_response": response.content,
        "current_stage": "finalize"
    }


# --- Router Function ---
def review_router(state: DataAnalysisWorkflowState) -> str:
    """
    Routes the workflow based on human review decision.
    """
    if state["approval_status"] == "approved":
        return "finalize"
    else:
        return "code_generation"  # Go back to code generation with feedback


# --- Graph Construction ---
builder = StateGraph(DataAnalysisWorkflowState)

# Add all nodes
builder.add_node("data_exploration", data_exploration_node)
builder.add_node("analysis_planning", analysis_planning_node)
builder.add_node("code_generation", code_generation_node)
builder.add_node("code_execution", code_execution_node)
builder.add_node("visualization_generation", visualization_generation_node)
builder.add_node("human_review", human_review_node)
builder.add_node("finalize", finalize_node)

# Define the flow
builder.add_edge(START, "data_exploration")
builder.add_edge("data_exploration", "analysis_planning")
builder.add_edge("analysis_planning", "code_generation")
builder.add_edge("code_generation", "code_execution")
builder.add_edge("code_execution", "visualization_generation")
builder.add_edge("visualization_generation", "human_review")
builder.add_conditional_edges(
    "human_review",
    review_router,
    {
        "finalize": "finalize",
        "code_generation": "code_generation"
    }
)
builder.add_edge("finalize", END)

# Compile with interrupt before human_review for HITL
# Also support interrupt after code_generation
memory = MemorySaver()
data_analysis_graph = builder.compile(
    interrupt_before=["human_review", "code_generation"],  # Pause at multiple points
    checkpointer=memory
)

# --- Exports ---
__all__ = ["data_analysis_graph", "DataAnalysisWorkflowState"]

