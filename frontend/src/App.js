import React, { useState, useRef, useEffect } from "react";
import AssistantService from "./AssistantService";
import ReactMarkdown from "react-markdown";
import HitlWorkflow from "./HitlWorkflow";
import DataAnalysisDemo from "./DataAnalysisDemo";
import "./App.css";

// Flag to toggle between blocking API and streaming API
const USE_STREAMING = true;

const BasicApp = () => {
  // UI states: idle, waiting, user_feedback, finished
  const [uiState, setUiState] = useState("idle");
  const [question, setQuestion] = useState("");
  const [assistantResponse, setAssistantResponse] = useState("");
  const [feedback, setFeedback] = useState("");
  const [threadId, setThreadId] = useState(null);
  const [history, setHistory] = useState([]);
  const [errorMessage, setErrorMessage] = useState(null);

  // Refs for tracking accumulated responses in streaming mode
  const startAccumulatedResponseRef = useRef("");
  const approveAccumulatedResponseRef = useRef("");
  const feedbackAccumulatedResponseRef = useRef("");

  const feedbackInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (uiState === "feedback_form" && feedbackInputRef.current) {
      feedbackInputRef.current.focus();
    }
  }, [uiState]);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, assistantResponse, uiState]);

  // Submit handlers
  const handleStart = async () => {
    if (!question.trim()) return;

    // Show user message and pending spinner immediately
    setUiState("waiting");
    setHistory([
      { role: "user", content: question },
      { role: "assistant", content: null } // null means pending/spinner
    ]);

    try {
      if (!USE_STREAMING) {
        // Original blocking API call
        const data = await AssistantService.startConversation(question);
        setAssistantResponse(data.assistant_response);
        setUiState("idle"); // Always set to idle to show review buttons first
        setThreadId(data.thread_id);
        setHistory([
          { role: "user", content: question },
          { role: "assistant", content: data.assistant_response }
        ]);
      } else {
        // Streaming API call
        const data = await AssistantService.createStreamingConversation(question);
        setThreadId(data.thread_id);

        // Initialize an empty response that will be built up token by token
        setAssistantResponse("");

        // Reset the accumulated response ref for this session
        startAccumulatedResponseRef.current = "";

        // Start streaming the response
        const eventSource = AssistantService.streamResponse(
          data.thread_id,
          // Message callback - handle incoming tokens
          (data) => {
            if (data.content) {
              // Update our ref with the new content
              startAccumulatedResponseRef.current += data.content;

              // Update React state with the accumulated content
              setAssistantResponse(startAccumulatedResponseRef.current);

              // Update history with current accumulated response
              setHistory([
                { role: "user", content: question },
                { role: "assistant", content: startAccumulatedResponseRef.current }
              ]);
            } else if (data.status) {
              // Update UI state based on status updates
              if (data.status === "user_feedback") {
                setUiState("idle"); // Show review buttons
              } else if (data.status === "finished") {
                setUiState("finished");
              }
            }
          },
          // Error callback
          (error) => {
            console.error("Streaming error:", error);
            setUiState("idle");
            // Check if error has a message property before using it
            const errMsg = error && error.message ? error.message : "Unknown error";
            setErrorMessage(errMsg);
            alert("Streaming error: " + errMsg);
          },
          // Complete callback
          () => {
            console.log("Stream completed");
            // Final history update is already handled in the message callback
          }
        );
      }
    } catch (err) {
      setAssistantResponse("");
      setUiState("idle");
      // Check if error has a message property before using it
      const errMsg = err && err.message ? err.message : "Unknown error";
      setErrorMessage(errMsg);
      alert("Failed to contact backend: " + errMsg);
    }
  };

  const handleApprove = async () => {
    setUiState("waiting");
    setHistory([...history, { role: "assistant", content: null }]); // Show spinner

    try {
      if (!USE_STREAMING) {
        // Original blocking API call
        const data = await AssistantService.submitReview({
          thread_id: threadId,
          review_action: "approved"
        });
        setAssistantResponse(data.assistant_response);
        setUiState("finished"); // Transition to finished state after approval
        // Replace last assistant (spinner) with real response
        setHistory(prev => [
          ...prev.slice(0, -1),
          { role: "assistant", content: data.assistant_response }
        ]);
      } else {
        // Streaming API call
        const data = await AssistantService.resumeStreamingConversation({
          thread_id: threadId,
          review_action: "approved"
        });

        // Initialize an empty response that will be built up token by token
        setAssistantResponse("");

        // Reset the accumulated response ref for this session
        approveAccumulatedResponseRef.current = "";

        // Start streaming the response
        const eventSource = AssistantService.streamResponse(
          threadId,
          // Message callback - handle incoming tokens
          (data) => {
            if (data.content) {
              // Update our ref with the new content
              approveAccumulatedResponseRef.current += data.content;

              // Update React state with the accumulated content
              setAssistantResponse(approveAccumulatedResponseRef.current);

              // Update the spinner message with the current tokens
              setHistory(prev => [
                ...prev.slice(0, -1),
                { role: "assistant", content: approveAccumulatedResponseRef.current }
              ]);
            } else if (data.status) {
              // Update UI state based on status updates
              if (data.status === "finished") {
                setUiState("finished");
              }
            }
          },
          // Error callback
          (error) => {
            console.error("Streaming error:", error);
            setUiState("idle");
            // Check if error has a message property before using it
            const errMsg = error && error.message ? error.message : "Unknown error";
            setErrorMessage(errMsg);
            alert("Streaming error: " + errMsg);
          },
          // Complete callback
          () => {
            console.log("Stream completed");
            // Final history update is already handled in the message callback
          }
        );
      }
    } catch (err) {
      setUiState("idle");
      // Check if error has a message property before using it
      const errMsg = err && err.message ? err.message : "Unknown error";
      setErrorMessage(errMsg);
      alert("Failed to contact backend: " + errMsg);
    }
  };

  const handleFeedback = async () => {
    if (!feedback.trim()) return;

    setUiState("waiting");
    setHistory([
      ...history,
      { role: "user", content: feedback },
      { role: "assistant", content: null }
    ]); // Show spinner after feedback

    try {
      if (!USE_STREAMING) {
        // Original blocking API call
        const data = await AssistantService.submitReview({
          thread_id: threadId,
          review_action: "feedback",
          human_comment: feedback
        });
        setAssistantResponse(data.assistant_response);
        setUiState("idle"); // Return to review state after feedback
        // Replace last assistant (spinner) with real response
        setHistory(prev => [
          ...prev.slice(0, -1),
          { role: "assistant", content: data.assistant_response }
        ]);
        setFeedback("");
      } else {
        // Streaming API call
        const data = await AssistantService.resumeStreamingConversation({
          thread_id: threadId,
          review_action: "feedback",
          human_comment: feedback
        });

        // Initialize an empty response that will be built up token by token
        setAssistantResponse("");

        // Reset the accumulated response ref for this session
        feedbackAccumulatedResponseRef.current = "";

        // Start streaming the response
        const eventSource = AssistantService.streamResponse(
          threadId,
          // Message callback - handle incoming tokens
          (data) => {
            if (data.content) {
              // Update our ref with the new content
              feedbackAccumulatedResponseRef.current += data.content;

              // Update React state with the accumulated content
              setAssistantResponse(feedbackAccumulatedResponseRef.current);

              // Update the spinner message with the current tokens
              setHistory(prev => [
                ...prev.slice(0, -1),
                { role: "assistant", content: feedbackAccumulatedResponseRef.current }
              ]);
            } else if (data.status) {
              // Update UI state based on status updates
              if (data.status === "user_feedback") {
                setUiState("idle"); // Show review buttons
              } else if (data.status === "finished") {
                setUiState("finished");
              }
            }
          },
          // Error callback
          (error) => {
            console.error("Streaming error:", error);
            setUiState("idle");
            // Check if error has a message property before using it
            const errMsg = error && error.message ? error.message : "Unknown error";
            setErrorMessage(errMsg);
            alert("Streaming error: " + errMsg);
          },
          // Complete callback
          () => {
            console.log("Stream completed");
            // Final history update is already handled in the message callback
          }
        );

        setFeedback(""); // Clear feedback field
      }
    } catch (err) {
      setUiState("idle");
      // Check if error has a message property before using it
      const errMsg = err && err.message ? err.message : "Unknown error";
      setErrorMessage(errMsg);
      alert("Failed to contact backend: " + errMsg);
    }
  };

  const resetSession = () => {
    setUiState("idle");
    setQuestion("");
    setAssistantResponse("");
    setFeedback("");
    setThreadId(null);
    setHistory([]);
    setErrorMessage(null);
  };

  // Render
  return (
    <div className="app-container">
      <div className="sidebar">
        <img src="/hitl-assistent.png" alt="HITL Graph" className="sidebar-image" />
        <div className="sidebar-title">HITL Assistant Graph</div>
        <div className="sidebar-desc">
          Human-in-the-Loop workflow with LangGraph and FastAPI.
        </div>
      </div>

      <div className="chat-container">
        <div className="chat-header">
          <h2>Assistant</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button onClick={resetSession} className="btn-secondary">
              New Session
            </button>
          </div>
        </div>

        <div className="messages-area">
          {errorMessage && (
            <div style={{
              padding: '1rem',
              margin: '1rem',
              backgroundColor: '#fee',
              border: '1px solid #fcc',
              borderRadius: '4px',
              color: '#c33'
            }}>
              <strong>Error:</strong> {errorMessage}
              <button
                onClick={() => setErrorMessage(null)}
                style={{
                  float: 'right',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1.2rem',
                  color: '#c33'
                }}
              >
                ×
              </button>
            </div>
          )}

          {history.length === 0 && uiState === "idle" && (
            <div style={{ textAlign: 'center', marginTop: '4rem', color: 'var(--text-secondary)' }}>
              <p>Start a conversation to begin.</p>
            </div>
          )}

          {history.map((msg, idx) => {
            // Hide the last assistant message if in finished state (it's shown in Final Version block)
            if (uiState === "finished" && msg.role === "assistant" && idx === history.length - 1) {
              return null;
            }

            return (
              <div key={idx} className={`message ${msg.role}`}>
                <div className="message-label">
                  {msg.role === "user" ? "You" : "Assistant"}
                </div>
                <div className="message-content">
                  {msg.role === "assistant" && msg.content === null ? (
                    <div className="spinner" />
                  ) : msg.role === "assistant" ? (
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            );
          })}

          {uiState === "finished" && (
            <div className="final-version">
              <div className="final-label">
                <span style={{ fontSize: '1.2rem' }}>✨</span> Final Approved Version
              </div>
              <ReactMarkdown>{assistantResponse}</ReactMarkdown>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="input-area">
          {uiState === "idle" && history.length === 0 && (
            <div className="input-group">
              <input
                type="text"
                placeholder="Ask a question..."
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleStart(); }}
                className="chat-input"
                autoFocus
              />
              <button onClick={handleStart} className="btn-primary">Send</button>
            </div>
          )}

          {uiState === "user_feedback" && (
            <div className="feedback-form">
              <div className="feedback-title">Provide Feedback</div>
              <textarea
                ref={feedbackInputRef}
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                className="feedback-textarea"
                placeholder="How should the assistant improve this answer?"
              />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={handleFeedback} className="btn-primary">
                  Submit Feedback
                </button>
                <button onClick={() => { setUiState("idle"); setFeedback(""); }} className="btn-secondary">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {uiState === "idle" && (assistantResponse || (history.length > 0 && history[history.length - 1].role === "assistant" && history[history.length - 1].content)) && (
            <div className="action-area">
              <button onClick={() => setUiState("user_feedback")} className="btn-secondary">
                Provide Feedback
              </button>
              <button onClick={handleApprove} className="btn-primary">
                Approve
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Documentation Modal Component
const DocumentationModal = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📚 Documentation - How to Use This Project</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <ReactMarkdown>{`# LangGraph HITL FastAPI Demo - Complete Guide

## 🎯 Project Overview

This project demonstrates **Human-in-the-Loop (HITL)** workflows using LangGraph and FastAPI. It provides three different workflow modes for various use cases:

1. **Basic HITL** - Simple conversation with feedback loop
2. **Custom Workflow (4-Stage)** - Multi-stage content generation workflow
3. **Data Analysis (CSV)** - Advanced CSV data analysis with code generation

---

## 🚀 Getting Started

### Prerequisites
- Python 3.8+
- Node.js 14+
- npm or yarn

### Installation

\`\`\`bash
# Backend Setup
cd backend
pip install -r requirements.txt

# Frontend Setup
cd frontend
npm install
\`\`\`

### Running the Application

\`\`\`bash
# Terminal 1: Start Backend Server
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Terminal 2: Start Frontend
cd frontend
npm start
\`\`\`

The application will be available at \`http://localhost:3000\`

---

## 📖 Workflow Modes

### 1. Basic HITL

**Purpose**: Simple conversational AI with human feedback loop.

**How to Use**:
1. Click on "Basic HITL" in the navbar
2. Enter your question in the input field
3. Wait for the AI assistant to generate a response
4. Review the response and choose:
   - **Provide Feedback**: Give specific feedback to improve the answer
   - **Approve**: Accept the answer and get the final version

**Example**:
- Question: "Explain quantum computing in simple terms"
- After response, provide feedback: "Make it shorter and add an example"
- The AI will regenerate with your feedback incorporated

**Use Cases**:
- Q&A systems
- Content refinement
- Educational explanations
- Customer support

---

### 2. Custom Workflow (4-Stage)

**Purpose**: Multi-stage content generation with research, drafting, and review stages.

**How to Use**:
1. Click on "Custom Workflow (4-Stage)" in the navbar
2. Enter your query (e.g., "Write a blog post about renewable energy")
3. The workflow will automatically go through:
   - **Stage 1: Research** - Gathers information and context
   - **Stage 2: Draft** - Creates initial draft content
   - **Stage 3: Review (HITL)** - Pauses for your feedback
   - **Stage 4: Finalize** - Produces the final polished version

**At Review Stage**:
- **Submit Feedback**: Provide specific improvements (e.g., "Add more statistics", "Make the tone more casual")
- **Approve & Finalize**: Accept the draft and proceed to finalization

**Example**:
- Query: "Write a technical article about machine learning"
- At review stage, provide feedback: "Add code examples and make it more beginner-friendly"
- The system will revise the draft based on your feedback

**Use Cases**:
- Blog post generation
- Technical documentation
- Content creation workflows
- Article writing with quality control

---

### 3. Data Analysis (CSV)

**Purpose**: Advanced CSV data analysis with automatic code generation, execution, and visualization.

**How to Use**:
1. Click on "Data Analysis (CSV)" in the navbar
2. **Upload a CSV file** using the file input
3. Enter your analysis query (e.g., "Analyze stock price trends" or "Find correlations in car prices")
4. Click "Start Analysis"
5. The workflow goes through 7 stages:
   - **Data Exploration**: Automatically explores your dataset
   - **Analysis Planning**: Creates a detailed analysis plan
   - **Code Generation**: Generates Python code (you can interrupt here)
   - **Code Execution**: Runs the generated code safely
   - **Visualization**: Creates data visualizations
   - **Human Review**: Pauses for your review and feedback
   - **Finalization**: Produces comprehensive final report

**Interrupt Features**:
- **During Generation**: Send interrupt messages to guide the analysis in real-time
- **At Review Stage**: Provide feedback on code, visualizations, or analysis plan

**Example Workflow**:
1. Upload: \`stock_prices.csv\`
2. Query: "Analyze the price trends and identify the best performing stocks"
3. During code generation, interrupt: "Focus on the last 6 months only"
4. At review stage, provide feedback: "Add a correlation heatmap"
5. Approve to get the final comprehensive report

**Supported Libraries**:
- pandas (data manipulation)
- matplotlib (plotting)
- seaborn (statistical visualizations)
- numpy (numerical operations)

**Use Cases**:
- Stock market analysis
- Sales data analysis
- Customer behavior analysis
- Scientific data exploration
- Business intelligence

---

## 🎨 Features

### Dark/Light Mode Toggle
- Click the theme toggle button (🌙/☀️) in the navbar to switch between dark and light modes
- Your preference is saved automatically

### Interrupt Capabilities
- **Message-based Interrupts**: Send messages during generation to provide real-time guidance
- **Stage-based Interrupts**: Automatic pauses at key decision points for human review

### Streaming Responses
- All workflows use streaming for real-time updates
- See responses appear token by token for better UX

### Session Management
- Each workflow maintains its own session
- Use "New Session" to start fresh
- Thread IDs are managed automatically

---

## 🔧 Technical Details

### Backend Architecture
- **FastAPI**: RESTful API server
- **LangGraph**: Workflow orchestration
- **LangChain**: LLM integration
- **Server-Sent Events (SSE)**: Real-time streaming

### Frontend Architecture
- **React**: UI framework
- **ReactMarkdown**: Markdown rendering
- **CSS Variables**: Theme system

### API Endpoints

**Basic HITL**:
- \`POST /start\` - Start conversation
- \`POST /review\` - Submit review/feedback
- \`GET /stream/{thread_id}\` - Stream responses

**Custom Workflow**:
- \`POST /custom-workflow/start\` - Start workflow
- \`POST /custom-workflow/resume\` - Resume after feedback
- \`GET /custom-workflow/stream/{thread_id}\` - Stream workflow updates

**Data Analysis**:
- \`POST /data-analysis/upload\` - Upload CSV file
- \`POST /data-analysis/start\` - Start analysis
- \`POST /data-analysis/interrupt\` - Send interrupt message
- \`POST /data-analysis/resume\` - Resume after review
- \`GET /data-analysis/stream/{thread_id}\` - Stream analysis updates

---

## 💡 Best Practices

1. **Be Specific in Queries**: More specific queries yield better results
2. **Use Feedback Effectively**: Provide clear, actionable feedback
3. **Interrupt When Needed**: Don't wait for completion if you see issues early
4. **Review Generated Code**: Always review code before execution in data analysis
5. **Start Fresh**: Use "New Session" when switching between different tasks

---

## 🐛 Troubleshooting

**Backend not responding**:
- Check if backend is running on port 8000
- Verify CORS settings if accessing from different origin

**File upload fails**:
- Ensure CSV file is valid and not corrupted
- Check file size limits

**Streaming stops**:
- Check browser console for errors
- Verify network connection
- Try refreshing the page

**Theme not persisting**:
- Clear browser cache and try again
- Check localStorage is enabled

---

## 📝 Example Queries

### Basic HITL
- "Explain how neural networks work"
- "Write a summary of climate change impacts"
- "Describe the process of photosynthesis"

### Custom Workflow
- "Write a blog post about sustainable energy"
- "Create a technical guide for API design"
- "Draft an article about the future of AI"

### Data Analysis
- "Analyze sales trends over the past year"
- "Find correlations between price and features"
- "Identify outliers in the dataset"
- "Create visualizations showing monthly patterns"

---

## 🎓 Learning Resources

- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [React Documentation](https://react.dev/)

---

## 🤝 Contributing

This is a demo project showcasing HITL workflows. Feel free to extend it with:
- Additional workflow types
- More visualization options
- Enhanced interrupt capabilities
- Custom analysis templates

---

## 📄 License

This project is a demonstration of HITL workflows using LangGraph and FastAPI.`}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
};

// Main App component with workflow mode selection
const App = () => {
  const [workflowMode, setWorkflowMode] = useState(() => {
    // Try to get from localStorage, default to "basic"
    return localStorage.getItem("workflowMode") || "basic";
  });
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "light");
  const [showDocumentation, setShowDocumentation] = useState(false);

  // Save workflow mode to localStorage when it changes
  useEffect(() => {
    localStorage.setItem("workflowMode", workflowMode);
  }, [workflowMode]);

  // Theme effect
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === "light" ? "dark" : "light");
  };

  const handleHome = () => {
    setWorkflowMode("basic");
  };

  return (
    <div>
      <nav className="navbar">
        <div className="navbar-container">
          <div className="navbar-left">
            <button
              onClick={handleHome}
              className="navbar-home-btn"
              title="Home"
            >
              🏠 Home
            </button>
          </div>

          <div className="navbar-center">
            <button
              onClick={() => setWorkflowMode("basic")}
              className={workflowMode === "basic" ? "active" : ""}
            >
              Basic HITL
            </button>
            <button
              onClick={() => setWorkflowMode("custom")}
              className={workflowMode === "custom" ? "active" : ""}
            >
              Iterative HITL Generation
            </button>
            <button
              onClick={() => setWorkflowMode("data-analysis")}
              className={workflowMode === "data-analysis" ? "active" : ""}
            >
              Data Analysis (CSV)
            </button>
          </div>

          <div className="navbar-right">
            <button
              onClick={() => setShowDocumentation(true)}
              className="navbar-doc-btn"
              title="Documentation"
            >
              📚 Documentation
            </button>
            <button
              onClick={toggleTheme}
              className="navbar-theme-btn"
              title={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
            >
              {theme === "light" ? "🌙" : "☀️"}
            </button>
          </div>
        </div>
      </nav>

      <DocumentationModal
        isOpen={showDocumentation}
        onClose={() => setShowDocumentation(false)}
      />

      {workflowMode === "custom" ? <HitlWorkflow /> :
        workflowMode === "data-analysis" ? <DataAnalysisDemo /> :
          <BasicApp />}
    </div>
  );
};

export default App;
