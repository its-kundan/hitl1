from typing import Literal, Optional, Dict, Any
from langgraph.graph import StateGraph, MessagesState, START, END
from langchain_community.chat_models import ChatOllama
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from langgraph.checkpoint.memory import MemorySaver
from dotenv import load_dotenv
import os
import re
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
# Using Ollama with llama2:latest locally
model = ChatOllama(model="llama2:latest", base_url="http://localhost:11434", temperature=0.7)

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
    visualization_paths: Optional[list] = None  # Support multiple visualizations
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


def clean_code_from_markdown(code: str) -> str:
    """
    Extract Python code from markdown code blocks.
    Removes ```python, ```, and any markdown formatting.
    More robust version that handles various edge cases.
    """
    if not code:
        return ""
    
    import re
    
    # Remove all markdown code block markers more aggressively
    # Pattern 1: ```python ... ```
    pattern1 = r'```python\s*(.*?)\s*```'
    matches = re.findall(pattern1, code, re.DOTALL)
    if matches:
        code = matches[0].strip()
    else:
        # Pattern 2: ``` ... ``` (generic code block)
        pattern2 = r'```\s*(.*?)\s*```'
        matches = re.findall(pattern2, code, re.DOTALL)
        if matches:
            # Take the first match that looks like Python code
            for match in matches:
                cleaned = match.strip()
                # Check if it looks like Python code (has common Python keywords)
                if any(keyword in cleaned for keyword in ['import ', 'def ', 'print(', 'pd.', 'df.', 'plt.', '=']):
                    code = cleaned
                    break
            else:
                # If no Python-like code found, take the first match
                code = matches[0].strip()
    
    # Remove any remaining markdown artifacts
    # Remove lines that are just ```python or ```
    lines = code.split('\n')
    cleaned_lines = []
    for line in lines:
        stripped = line.strip()
        # Skip lines that are just markdown markers
        if stripped in ['```python', '```', '```py']:
            continue
        # Skip lines that start with ``` but might have content
        if stripped.startswith('```'):
            # Try to extract content after ```
            remaining = stripped[3:].strip()
            if remaining and not remaining.startswith('python'):
                cleaned_lines.append(remaining)
            continue
        cleaned_lines.append(line)
    
    code = '\n'.join(cleaned_lines)
    
    # Final cleanup: remove any remaining ``` markers
    code = re.sub(r'```[a-z]*', '', code)
    code = re.sub(r'```', '', code)
    
    # Remove leading/trailing whitespace and newlines
    code = code.strip()
    
    # Remove leading/trailing whitespace from each line but preserve indentation
    lines = code.split('\n')
    cleaned_lines = []
    for line in lines:
        # Don't strip completely, preserve indentation
        if line.strip():  # Only add non-empty lines
            cleaned_lines.append(line)
    code = '\n'.join(cleaned_lines)
    
    return code.strip()


def execute_code_safely(code: str, file_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Execute Python code in a safe environment.
    Returns a dictionary with execution results and any output.
    """
    import sys
    from io import StringIO
    
    # Store original for debugging
    original_code = code
    
    # Clean code from markdown blocks
    code = clean_code_from_markdown(code)
    
    # Additional safety check: if code still contains markdown markers, try more aggressive cleaning
    if '```' in code:
        # Last resort: remove all lines containing ```
        lines = code.split('\n')
        code = '\n'.join([line for line in lines if '```' not in line])
        code = code.strip()
    
    # Final validation: check if code looks valid
    if not code or len(code.strip()) < 3:
        return {
            "success": False,
            "output": None,
            "error": f"No valid code found after cleaning. Original code length: {len(original_code)}. Cleaned code: '{code[:100]}...'"
        }
    
    # Check if code still has syntax errors from markdown
    if code.strip().startswith('```') or code.strip().endswith('```'):
        # Force remove remaining markers
        code = code.strip().lstrip('`').rstrip('`').strip()
        if code.startswith('python'):
            code = code[6:].strip()
    
    # Capture stdout and stderr
    stdout_capture = StringIO()
    stderr_capture = StringIO()
    
    try:
        # Create a safe execution environment
        exec_globals = {
            'pd': pd,
            'plt': plt,
            'sns': sns,
            'np': __import__('numpy'),
            'os': os,
            'json': json,
            'datetime': datetime,
            'df': None  # Will be set by the code
        }
        
        # Load the dataframe first if file_path is provided
        if file_path:
            exec_globals['df'] = load_dataframe(file_path)
        
        # Redirect stdout and stderr
        old_stdout = sys.stdout
        old_stderr = sys.stderr
        sys.stdout = stdout_capture
        sys.stderr = stderr_capture
        
        try:
            # Execute the code
            exec(code, exec_globals)
            
            # Get captured output
            stdout_output = stdout_capture.getvalue()
            stderr_output = stderr_capture.getvalue()
            
            # Build results
            results = []
            if stdout_output:
                results.append(stdout_output)
            
            if stderr_output:
                results.append(f"Warnings/Errors:\n{stderr_output}")
            
            # Check if any variables were created that might be useful
            if 'df' in exec_globals and exec_globals['df'] is not None:
                df_info = f"\nDataFrame shape: {exec_globals['df'].shape}"
                results.append(df_info)
            
            execution_output = "\n".join(results) if results else "Code executed successfully (no output)."
            
            return {
                "success": True,
                "output": execution_output,
                "error": None
            }
        finally:
            # Restore stdout and stderr
            sys.stdout = old_stdout
            sys.stderr = old_stderr
            
    except SyntaxError as e:
        # Special handling for syntax errors - likely markdown not cleaned properly
        import traceback
        error_trace = traceback.format_exc()
        
        # Check if error is due to markdown markers
        if '```' in str(e) or '```' in original_code or '```' in code:
            # Try one more aggressive clean
            code_retry = original_code
            # Remove all lines with ``` and empty lines
            lines = code_retry.split('\n')
            code_retry = '\n'.join([line for line in lines if '```' not in line and line.strip()])
            code_retry = code_retry.replace('```python', '').replace('```py', '').replace('```', '').strip()
            
            # Remove any remaining markdown artifacts
            code_retry = re.sub(r'^```[a-z]*\s*', '', code_retry, flags=re.MULTILINE)
            code_retry = re.sub(r'\s*```$', '', code_retry, flags=re.MULTILINE)
            code_retry = code_retry.strip()
            
            if code_retry and code_retry != code and len(code_retry) > 3:
                # Try executing the retry code with fresh environment
                try:
                    retry_globals = {
                        'pd': pd,
                        'plt': plt,
                        'sns': sns,
                        'np': __import__('numpy'),
                        'os': os,
                        'json': json,
                        'datetime': datetime,
                        'df': None
                    }
                    if file_path:
                        retry_globals['df'] = load_dataframe(file_path)
                    
                    # Create new capture streams
                    retry_stdout = StringIO()
                    retry_stderr = StringIO()
                    old_stdout_retry = sys.stdout
                    old_stderr_retry = sys.stderr
                    sys.stdout = retry_stdout
                    sys.stderr = retry_stderr
                    
                    try:
                        exec(code_retry, retry_globals)
                        # If successful, return success
                        retry_stdout_output = retry_stdout.getvalue()
                        retry_stderr_output = retry_stderr.getvalue()
                        results = []
                        if retry_stdout_output:
                            results.append(retry_stdout_output)
                        if retry_stderr_output:
                            results.append(f"Warnings/Errors:\n{retry_stderr_output}")
                        execution_output = "\n".join(results) if results else "Code executed successfully after cleaning markdown."
                        return {
                            "success": True,
                            "output": execution_output,
                            "error": None
                        }
                    finally:
                        sys.stdout = old_stdout_retry
                        sys.stderr = old_stderr_retry
                except Exception as retry_error:
                    # Retry also failed, continue with original error
                    pass
        
        return {
            "success": False,
            "output": None,
            "error": f"Syntax Error: {str(e)}\n\nThis might be due to markdown code blocks not being properly removed.\n\nFirst 200 chars of cleaned code:\n{code[:200]}\n\nTraceback:\n{error_trace}"
        }
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        return {
            "success": False,
            "output": None,
            "error": f"Error executing code: {str(e)}\n\nTraceback:\n{error_trace}"
        }


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
    
    # Extract code from markdown code blocks using the cleaning function
    code_content = clean_code_from_markdown(response.content)
    
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
    - Load the CSV file from the provided path (variable 'df' is already loaded)
    - Create multiple relevant visualizations (plots, charts, graphs)
    - Use matplotlib and seaborn
    - IMPORTANT: Save each visualization using plt.savefig() with a unique filename
    - Use the 'save_visualization' function: save_visualization(fig, filename) to save plots
    - Create at least 1-2 visualizations that are appropriate for the data type
    - For stock market data: line charts, candlestick patterns, moving averages
    - For car prices: scatter plots, correlation heatmaps, price distributions
    - For demographics: bar charts, scatter plots, comparisons
    - Always call plt.tight_layout() before saving
    - Close figures with plt.close() after saving to free memory
    
    Example structure:
    ```python
    import matplotlib.pyplot as plt
    import seaborn as sns
    
    # Create first visualization
    fig, ax = plt.subplots(figsize=(10, 6))
    # ... plotting code ...
    plt.tight_layout()
    save_visualization(fig, 'viz1.png')
    plt.close(fig)
    
    # Create second visualization if needed
    # ...
    ```
    
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
    
    # Extract code from markdown using the cleaning function
    viz_code = clean_code_from_markdown(response.content)
    
    # Execute visualization code
    viz_paths = []
    try:
        exec_globals = {
            'pd': pd,
            'plt': plt,
            'sns': sns,
            'np': __import__('numpy'),
            'save_visualization': save_visualization,
            'datetime': datetime,
            'os': os,
            'matplotlib': matplotlib
        }
        
        if state.get("file_path"):
            exec_globals['df'] = load_dataframe(state["file_path"])
        
        # Create uploads directory
        uploads_dir = os.path.join(os.path.dirname(__file__), "..", "uploads", "visualizations")
        os.makedirs(uploads_dir, exist_ok=True)
        
        # Get existing files before execution
        existing_files = set(os.listdir(uploads_dir)) if os.path.exists(uploads_dir) else set()
        
        # Add save_visualization helper to exec_globals with proper path
        def save_viz_helper(fig, filename):
            """Helper to save visualization with proper path handling"""
            if not filename.endswith('.png'):
                filename += '.png'
            return save_visualization(fig, filename)
        
        exec_globals['save_visualization'] = save_viz_helper
        
        # Execute visualization code
        exec(viz_code, exec_globals)
        
        # Check for newly created files
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        new_files = []
        if os.path.exists(uploads_dir):
            current_files = set(os.listdir(uploads_dir))
            new_files = [f for f in (current_files - existing_files) if f.endswith('.png')]
        
        # If no new files were created, try to save the current figure
        if not new_files:
            fig = plt.gcf()
            if fig and fig.get_axes():
                filename = f"viz_{timestamp}.png"
                viz_path = save_visualization(fig, filename)
                if viz_path:
                    viz_paths.append(os.path.basename(viz_path))
            else:
                # Try to find any open figures
                fig_manager = plt.get_current_fig_manager()
                if fig_manager:
                    fig = plt.gcf()
                    if fig.get_axes():
                        filename = f"viz_{timestamp}.png"
                        viz_path = save_visualization(fig, filename)
                        if viz_path:
                            viz_paths.append(os.path.basename(viz_path))
        else:
            # Use the newly created files
            viz_paths = [f for f in new_files if f.endswith('.png')]
        
        # If still no visualizations, create a default one
        if not viz_paths and state.get("file_path"):
            try:
                df = load_dataframe(state["file_path"])
                # Create a simple visualization
                fig, ax = plt.subplots(figsize=(10, 6))
                if len(df.columns) >= 2:
                    # Try to create a basic plot
                    numeric_cols = df.select_dtypes(include=['number']).columns
                    if len(numeric_cols) >= 2:
                        ax.scatter(df[numeric_cols[0]], df[numeric_cols[1]], alpha=0.6)
                        ax.set_xlabel(numeric_cols[0])
                        ax.set_ylabel(numeric_cols[1])
                        ax.set_title('Data Visualization')
                        plt.tight_layout()
                        filename = f"viz_{timestamp}.png"
                        viz_path = save_visualization(fig, filename)
                        if viz_path:
                            viz_paths.append(os.path.basename(viz_path))
            except Exception as e:
                pass
        
        # Clean up any open figures
        plt.close('all')
        
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        viz_code += f"\n\n# Error during visualization: {str(e)}\n{error_trace}"
        plt.close('all')
    
    # Store the first visualization path (or comma-separated list for multiple)
    viz_path = viz_paths[0] if viz_paths else None
    
    return {
        **state,
        "messages": all_messages,
        "visualization_code": viz_code,
        "visualization_path": viz_path,
        "visualization_paths": viz_paths if viz_paths else [],
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
__all__ = ["data_analysis_graph", "DataAnalysisWorkflowState", "execute_code_safely"]

