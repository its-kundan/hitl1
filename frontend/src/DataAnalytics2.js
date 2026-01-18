import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import "./App.css";

const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

const DataAnalytics2 = () => {
  const [uiState, setUiState] = useState("idle");
  const [currentStage, setCurrentStage] = useState(null);
  const [query, setQuery] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePath, setFilePath] = useState(null);
  const [fileName, setFileName] = useState(null);
  
  const [dataSummary, setDataSummary] = useState("");
  const [analysisPlan, setAnalysisPlan] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [executionResults, setExecutionResults] = useState("");
  const [visualizationPaths, setVisualizationPaths] = useState([]);
  const [finalReport, setFinalReport] = useState("");
  
  const [feedback, setFeedback] = useState("");
  const [threadId, setThreadId] = useState(null);
  const [history, setHistory] = useState([]);
  
  const messagesEndRef = useRef(null);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, dataSummary, analysisPlan, finalReport, uiState]);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const handleFileSelect = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    setSelectedFile(file);
    
    try {
      const formData = new FormData();
      formData.append("file", file);
      
      const response = await fetch(`${BASE_URL}/data-analytics2/upload`, {
        method: "POST",
        body: formData
      });
      
      const data = await response.json();
      if (data.file_path) {
        setFilePath(data.file_path);
        setFileName(data.file_name);
      } else {
        alert("Error uploading file: " + (data.error || "Unknown error"));
      }
    } catch (err) {
      alert("Failed to upload file: " + err.message);
    }
  };

  const handleStart = async () => {
    if (!query.trim()) {
      alert("Please enter an analysis query");
      return;
    }

    if (!filePath) {
      alert("Please upload a CSV file first");
      return;
    }

    setUiState("exploring");
    setCurrentStage("data_exploration");
    setDataSummary("");
    setAnalysisPlan("");
    setGeneratedCode("");
    setExecutionResults("");
    setVisualizationPaths([]);
    setFinalReport("");
    
    setHistory([{ role: "user", content: `Query: ${query} | File: ${fileName}` }]);
    
    try {
      const formData = new FormData();
      formData.append("human_request", query);
      formData.append("file_path", filePath);
      formData.append("file_name", fileName);
      
      const response = await fetch(`${BASE_URL}/data-analytics2/start`, {
        method: "POST",
        body: formData
      });
      
      const data = await response.json();
      setThreadId(data.thread_id);
      
      // Start streaming
      startStreaming(data.thread_id);
      
    } catch (err) {
      alert("Failed to start analysis: " + err.message);
      setUiState("idle");
    }
  };

  const startStreaming = (threadId) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    eventSourceRef.current = new EventSource(`${BASE_URL}/data-analytics2/stream/${threadId}`);
    
    eventSourceRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'status') {
          setCurrentStage(data.data.stage);
          if (data.data.stage === 'data_exploration') {
            setUiState("exploring");
          } else if (data.data.stage === 'analysis_planning') {
            setUiState("planning");
          } else if (data.data.stage === 'code_generation') {
            setUiState("generating");
          } else if (data.data.stage === 'code_execution') {
            setUiState("executing");
          } else if (data.data.stage === 'visualization_generation') {
            setUiState("visualizing");
          }
        } else if (data.type === 'data_summary') {
          setDataSummary(data.data);
          setUiState("exploring");
        } else if (data.type === 'analysis_plan') {
          setAnalysisPlan(data.data);
          setUiState("planning");
        } else if (data.type === 'generated_code') {
          setGeneratedCode(data.data);
          setUiState("generating");
        } else if (data.type === 'execution_results') {
          setExecutionResults(data.data);
          setUiState("executing");
        } else if (data.type === 'visualizations') {
          setVisualizationPaths(data.data || []);
          setUiState("visualizing");
        } else if (data.type === 'user_feedback') {
          setUiState("review");
        } else if (data.type === 'finished') {
          setFinalReport(data.data.final_report || "");
          setUiState("finished");
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
          }
        } else if (data.type === 'error') {
          alert("Error: " + data.data.message);
          setUiState("idle");
        }
      } catch (err) {
        console.error("Error parsing SSE data:", err);
      }
    };
    
    eventSourceRef.current.onerror = (error) => {
      console.error("SSE error:", error);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      setUiState("idle");
    };
  };

  const handleApprove = async () => {
    if (!threadId) return;
    
    try {
      const response = await fetch(`${BASE_URL}/data-analytics2/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: threadId,
          review_action: "approved"
        })
      });
      
      const data = await response.json();
      if (data.status === "resumed") {
        startStreaming(threadId);
      }
    } catch (err) {
      alert("Failed to approve: " + err.message);
    }
  };

  const handleFeedback = async () => {
    if (!threadId || !feedback.trim()) return;
    
    try {
      const response = await fetch(`${BASE_URL}/data-analytics2/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: threadId,
          review_action: "feedback",
          human_comment: feedback
        })
      });
      
      const data = await response.json();
      if (data.status === "resumed") {
        setFeedback("");
        startStreaming(threadId);
      }
    } catch (err) {
      alert("Failed to submit feedback: " + err.message);
    }
  };

  const resetSession = () => {
    setUiState("idle");
    setQuery("");
    setSelectedFile(null);
    setFilePath(null);
    setFileName(null);
    setDataSummary("");
    setAnalysisPlan("");
    setGeneratedCode("");
    setExecutionResults("");
    setVisualizationPaths([]);
    setFinalReport("");
    setFeedback("");
    setThreadId(null);
    setHistory([]);
    setCurrentStage(null);
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <img src="/hitl-assistent.png" alt="HITL Graph" className="sidebar-image" />
        <div className="sidebar-title">Data Analytics 2</div>
        <div className="sidebar-desc">
          Advanced data analysis with HITL workflow from data_analyst project.
        </div>
      </div>

      <div className="chat-container">
        <div className="chat-header">
          <h2>Data Analytics 2</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button onClick={resetSession} className="btn-secondary">
              New Session
            </button>
          </div>
        </div>

        <div className="messages-area">
          {history.length === 0 && uiState === "idle" && (
            <div style={{ textAlign: 'center', marginTop: '4rem', color: 'var(--text-secondary)' }}>
              <p>Upload a CSV file and enter your analysis query to begin.</p>
            </div>
          )}

          {history.map((msg, idx) => (
            <div key={idx} className={`message ${msg.role}`}>
              <div className="message-label">
                {msg.role === "user" ? "You" : "Assistant"}
              </div>
              <div className="message-content">
                {msg.content}
              </div>
            </div>
          ))}

          {dataSummary && (
            <div className="message assistant">
              <div className="message-label">Data Summary</div>
              <div className="message-content">
                <ReactMarkdown>{dataSummary}</ReactMarkdown>
              </div>
            </div>
          )}

          {analysisPlan && (
            <div className="message assistant">
              <div className="message-label">Analysis Plan</div>
              <div className="message-content">
                <ReactMarkdown>{analysisPlan}</ReactMarkdown>
              </div>
            </div>
          )}

          {generatedCode && uiState !== "finished" && (
            <div className="message assistant">
              <div className="message-label">Generated Code</div>
              <div className="message-content">
                <pre style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '4px', overflow: 'auto' }}>
                  {generatedCode}
                </pre>
              </div>
            </div>
          )}

          {executionResults && (
            <div className="message assistant">
              <div className="message-label">Execution Results</div>
              <div className="message-content">
                <pre style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '4px', overflow: 'auto' }}>
                  {executionResults}
                </pre>
              </div>
            </div>
          )}

          {visualizationPaths.length > 0 && (
            <div className="message assistant">
              <div className="message-label">Visualizations</div>
              <div className="message-content">
                {visualizationPaths.map((path, idx) => (
                  <div key={idx} style={{ marginBottom: '1rem' }}>
                    <img 
                      src={`${BASE_URL}/${path}`} 
                      alt={`Visualization ${idx + 1}`}
                      style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px' }}
                      onError={(e) => {
                        e.target.style.display = 'none';
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {finalReport && (
            <div className="final-version">
              <div className="final-label">
                <span style={{ fontSize: '1.2rem' }}>✨ Final Report</span>
              </div>
              <ReactMarkdown>{finalReport}</ReactMarkdown>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="input-area">
          {uiState === "idle" && (
            <div className="input-group">
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem' }}>Upload CSV File:</label>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelect}
                  style={{ width: '100%', padding: '0.5rem' }}
                />
                {fileName && <p style={{ marginTop: '0.5rem', color: 'var(--text-secondary)' }}>Selected: {fileName}</p>}
              </div>
              <input
                type="text"
                placeholder="Enter your analysis query..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleStart(); }}
                className="chat-input"
                autoFocus
              />
              <button onClick={handleStart} className="btn-primary" disabled={!filePath}>
                Start Analysis
              </button>
            </div>
          )}

          {uiState === "review" && (
            <div className="feedback-form">
              <div className="feedback-title">Review & Feedback</div>
              <textarea
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                className="feedback-textarea"
                placeholder="Provide feedback to improve the analysis..."
              />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={handleFeedback} className="btn-primary">
                  Submit Feedback
                </button>
                <button onClick={handleApprove} className="btn-secondary">
                  Approve & Continue
                </button>
              </div>
            </div>
          )}

          {(uiState === "exploring" || uiState === "planning" || uiState === "generating" || 
            uiState === "executing" || uiState === "visualizing") && (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
              <div className="spinner" />
              <p>Processing: {currentStage || uiState}...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DataAnalytics2;
