import React, { useState, useRef, useEffect } from "react";
import AssistantService from "./AssistantService";
import ReactMarkdown from "react-markdown";
import CustomWorkflowDemo from "./CustomWorkflowDemo";
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
            const errorMessage = error && error.message ? error.message : "Unknown error";
            alert("Streaming error: " + errorMessage);
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
      const errorMessage = err && err.message ? err.message : "Unknown error";
      alert("Failed to contact backend: " + errorMessage);
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
            const errorMessage = error && error.message ? error.message : "Unknown error";
            alert("Streaming error: " + errorMessage);
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
      const errorMessage = err && err.message ? err.message : "Unknown error";
      alert("Failed to contact backend: " + errorMessage);
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
            const errorMessage = error && error.message ? error.message : "Unknown error";
            alert("Streaming error: " + errorMessage);
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
      const errorMessage = err && err.message ? err.message : "Unknown error";
      alert("Failed to contact backend: " + errorMessage);
    }
  };

  const resetSession = () => {
    setUiState("idle");
    setQuestion("");
    setAssistantResponse("");
    setFeedback("");
    setThreadId(null);
    setHistory([]);
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

// Main App component with workflow mode selection
const App = () => {
  const [workflowMode, setWorkflowMode] = useState(() => {
    // Try to get from localStorage, default to "basic"
    return localStorage.getItem("workflowMode") || "basic";
  });
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "light");

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

  return (
    <div>
      <div style={{ 
        maxWidth: '1200px', 
        margin: '1rem auto', 
        padding: '0 1rem' 
      }}>
        <div className="workflow-selector">
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
            Custom Workflow (4-Stage)
          </button>
        </div>
      </div>
      {workflowMode === "custom" ? <CustomWorkflowDemo /> : <BasicApp />}
    </div>
  );
};

export default App;
