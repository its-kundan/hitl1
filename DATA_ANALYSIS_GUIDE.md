# Data Analysis Workflow Guide

## Overview
The Data Analysis Workflow is an advanced Human-in-the-Loop (HITL) system that enables comprehensive CSV data analysis with automatic code generation and visualization. It supports interrupts at multiple stages and message-based interrupts during generation.

## Features

### 1. **CSV File Support**
- Upload CSV files for analysis
- Automatic data exploration and summary generation
- Support for various data types (stock market, car prices, demographics, etc.)

### 2. **Multi-Stage Workflow**
The workflow consists of 7 stages:
1. **Data Exploration** - Load and explore the dataset
2. **Analysis Planning** - Create a detailed analysis plan
3. **Code Generation** - Generate Python code for analysis (HITL interrupt point)
4. **Code Execution** - Execute the generated code
5. **Visualization Generation** - Create data visualizations
6. **Human Review** - Review and provide feedback (HITL interrupt point)
7. **Finalization** - Generate comprehensive final report

### 3. **Interrupt Support**
- **Stage-based Interrupts**: Automatic pauses at `code_generation` and `human_review` stages
- **Message-based Interrupts**: Send messages during generation to provide real-time feedback

### 4. **Code Generation & Execution**
- Automatic Python code generation using AI
- Safe code execution environment
- Support for pandas, matplotlib, seaborn, numpy

### 5. **Visualization**
- Automatic visualization generation
- Multiple chart types (line, bar, scatter, etc.)
- Saved visualization images

## Usage

### Starting the Servers

```bash
# Terminal 1: Backend
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Terminal 2: Frontend
cd frontend
npm start
```

### Using the Web Interface

1. **Navigate to Data Analysis Mode**
   - Open http://localhost:3000
   - Select "Data Analysis (CSV)" from the workflow selector

2. **Upload a CSV File**
   - Click "Choose File" and select a CSV file
   - Or use one of the sample files provided:
     - `sample_stock_data.csv` - Stock market data
     - `sample_car_prices.csv` - Car pricing data
     - `sample_demographics.csv` - Demographic data

3. **Enter Analysis Query**
   - Examples:
     - "Analyze stock price trends and identify patterns"
     - "Find correlations between car price and mileage"
     - "Compare GDP per capita across different countries"

4. **Start Analysis**
   - Click "Start Analysis"
   - Watch the workflow progress through each stage

5. **Provide Feedback**
   - At the code generation stage, you can:
     - Review the generated code
     - Provide feedback to improve it
     - Approve to continue
   - At the human review stage, you can:
     - Review the complete analysis
     - Provide feedback for revisions
     - Approve to finalize

6. **Message-based Interrupts**
   - During generation (exploring, planning, generating, executing, visualizing):
     - Type a message in the interrupt field
     - Click "Send Interrupt"
     - The workflow will incorporate your feedback

### API Endpoints

#### Upload File
```bash
curl -X POST \
  -F "file=@path/to/file.csv" \
  http://localhost:8000/data-analysis/upload
```

#### Start Analysis
```bash
curl -X POST \
  -F "human_request=Analyze stock trends" \
  -F "file_path=/path/to/file.csv" \
  -F "file_name=stock_data.csv" \
  http://localhost:8000/data-analysis/start
```

#### Resume After Feedback
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "thread_id": "your-thread-id",
    "review_action": "feedback",
    "human_comment": "Add more statistical analysis"
  }' \
  http://localhost:8000/data-analysis/resume
```

#### Send Interrupt Message
```bash
curl -X POST \
  -F "thread_id=your-thread-id" \
  -F "message=Focus on correlation analysis" \
  http://localhost:8000/data-analysis/interrupt
```

#### Stream Analysis
```bash
curl --no-buffer \
  http://localhost:8000/data-analysis/stream/{thread_id}
```

## Sample Use Cases

### 1. Stock Market Analysis
**File**: `sample_stock_data.csv`
**Query**: "Analyze stock price trends, calculate moving averages, and identify patterns"

**Expected Output**:
- Data exploration report
- Analysis plan focusing on trends and patterns
- Python code for moving averages and trend analysis
- Visualizations showing price trends over time
- Final report with insights

### 2. Car Price Analysis
**File**: `sample_car_prices.csv`
**Query**: "Find correlations between price, mileage, and year. Identify the best value cars"

**Expected Output**:
- Correlation analysis
- Price vs. mileage scatter plots
- Year-based price trends
- Recommendations for best value cars

### 3. Demographic Analysis
**File**: `sample_demographics.csv`
**Query**: "Compare GDP per capita and life expectancy across countries. Identify relationships"

**Expected Output**:
- Country comparisons
- GDP vs. life expectancy analysis
- Visualizations showing relationships
- Insights on economic and health correlations

## Technical Details

### Workflow State
```python
class DataAnalysisWorkflowState:
    user_query: str
    file_path: Optional[str]
    file_name: Optional[str]
    data_summary: Optional[str]
    analysis_plan: Optional[str]
    generated_code: Optional[str]
    code_execution_results: Optional[str]
    visualization_code: Optional[str]
    visualization_path: Optional[str]
    human_feedback: Optional[str]
    approval_status: Literal["pending", "approved", "feedback"]
    final_report: Optional[str]
    revision_count: int
    interrupt_requested: bool
    current_stage: Optional[str]
```

### Interrupt Points
- `code_generation`: After analysis planning, before code generation
- `human_review`: After visualization, before finalization

### Dependencies
- pandas: Data manipulation
- numpy: Numerical operations
- matplotlib: Basic plotting
- seaborn: Statistical visualizations
- langchain: AI model integration
- langgraph: Workflow orchestration

## Best Practices

1. **File Preparation**
   - Ensure CSV files have headers
   - Clean data before uploading (handle missing values)
   - Use appropriate data types

2. **Query Formulation**
   - Be specific about what you want to analyze
   - Mention specific metrics or relationships
   - Request specific types of visualizations if needed

3. **Feedback Quality**
   - Provide specific, actionable feedback
   - Reference specific parts of the code or analysis
   - Suggest improvements rather than just pointing out issues

4. **Interrupt Usage**
   - Use interrupts to guide the analysis direction
   - Provide context about what you're looking for
   - Be timely - send interrupts when relevant

## Troubleshooting

### File Upload Issues
- Ensure file is valid CSV format
- Check file size (large files may take longer)
- Verify file path permissions

### Code Execution Errors
- Review generated code before execution
- Provide feedback to fix syntax errors
- Check data types match expectations

### Visualization Issues
- Ensure matplotlib backend is properly configured
- Check file permissions for saving visualizations
- Verify data is suitable for visualization

## Future Enhancements

- Support for Excel files (.xlsx)
- Multiple file uploads
- Custom visualization templates
- Export analysis reports as PDF
- Integration with Jupyter notebooks
- Real-time collaboration features

