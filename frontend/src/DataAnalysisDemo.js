import React, { useState, useRef, useEffect } from "react";
import AssistantService from "./AssistantService";
import ReactMarkdown from "react-markdown";
import "./App.css";

const DataAnalysisDemo = () => {
  const [uiState, setUiState] = useState("idle"); // idle, exploring, planning, generating, executing, visualizing, review, finalize, finished
  const [currentStage, setCurrentStage] = useState(null);
  const [query, setQuery] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePath, setFilePath] = useState(null);
  const [fileName, setFileName] = useState(null);
  
  const [dataSummary, setDataSummary] = useState("");
  const [analysisPlan, setAnalysisPlan] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [executionResults, setExecutionResults] = useState("");
  const [visualizationPath, setVisualizationPath] = useState(null);
  const [finalReport, setFinalReport] = useState("");
  
  const [feedback, setFeedback] = useState("");
  const [interruptMessage, setInterruptMessage] = useState("");
  const [threadId, setThreadId] = useState(null);
  const [revisionCount, setRevisionCount] = useState(0);
  const [history, setHistory] = useState([]);
  
  const dataSummaryRef = useRef("");
  const analysisPlanRef = useRef("");
  const codeRef = useRef("");
  const executionRef = useRef("");
  const visualizationRef = useRef("");
  const finalRef = useRef("");
  const messagesEndRef = useRef(null);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, dataSummary, analysisPlan, generatedCode, executionResults, finalReport, uiState]);

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
      
      const response = await fetch("http://localhost:8000/data-analysis/upload", {
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

    setUiState("exploring");
    setCurrentStage("data_exploration");
    setDataSummary("");
    setAnalysisPlan("");
    setGeneratedCode("");
    setExecutionResults("");
    setVisualizationPath(null);
    setFinalReport("");
    setRevisionCount(0);
    
    dataSummaryRef.current = "";
    analysisPlanRef.current = "";
    codeRef.current = "";
    executionRef.current = "";
    visualizationRef.current = "";
    finalRef.current = "";
    
    setHistory([{ role: "user", content: `Query: ${query}${fileName ? ` | File: ${fileName}` : ""}` }]);
    
    try {
      const formData = new FormData();
      formData.append("human_request", query);
      if (filePath) {
        formData.append("file_path", filePath);
        formData.append("file_name", fileName);
      }
      
      const response = await fetch("http://localhost:8000/data-analysis/start", {
        method: "POST",
        body: formData
      });
      
      const data = await response.json();
      setThreadId(data.thread_id);
      
      // Start streaming
      eventSourceRef.current = AssistantService.streamDataAnalysis(
        data.thread_id,
        (data) => {
          if (data.node === "data_exploration" && data.content) {
            dataSummaryRef.current += data.content;
            setDataSummary(dataSummaryRef.current);
            setCurrentStage("data_exploration");
          } else if (data.node === "analysis_planning" && data.content) {
            analysisPlanRef.current += data.content;
            setAnalysisPlan(analysisPlanRef.current);
            setCurrentStage("analysis_planning");
            setUiState("planning");
          } else if (data.node === "code_generation" && data.content) {
            codeRef.current += data.content;
            setGeneratedCode(codeRef.current);
            setCurrentStage("code_generation");
            setUiState("generating");
          } else if (data.node === "code_execution" && data.content) {
            executionRef.current += data.content;
            setExecutionResults(executionRef.current);
            setCurrentStage("code_execution");
            setUiState("executing");
          } else if (data.node === "visualization_generation" && data.content) {
            visualizationRef.current += data.content;
            setCurrentStage("visualization_generation");
            setUiState("visualizing");
          } else if (data.node === "finalize" && data.content) {
            finalRef.current += data.content;
            setFinalReport(finalRef.current);
            setCurrentStage("finalize");
            setUiState("finalize");
          } else if (data.status === "user_feedback" || data.status === "code_review") {
            setUiState("review");
            setCurrentStage("review");
            if (data.code) {
              setGeneratedCode(data.code);
            }
            if (data.visualization_path) {
              setVisualizationPath(data.visualization_path);
            }
            if (data.analysis_plan) {
              setAnalysisPlan(data.analysis_plan);
            }
          } else if (data.status === "finished") {
            setUiState("finished");
            setCurrentStage(null);
            if (data.final_output) {
              setFinalReport(data.final_output);
            }
            if (data.visualization_path) {
              setVisualizationPath(data.visualization_path);
            }
            if (data.code) {
              setGeneratedCode(data.code);
            }
            if (eventSourceRef.current) {
              eventSourceRef.current.close();
            }
          }
        },
        (error) => {
          console.error("Error:", error);
          alert("Error: " + error.message);
          setUiState("idle");
        },
        () => {
          console.log("Stream completed");
        }
      );
    } catch (err) {
      alert("Failed to start analysis: " + err.message);
      setUiState("idle");
    }
  };

  const handleInterrupt = async () => {
    if (!interruptMessage.trim() || !threadId) return;
    
    try {
      const formData = new FormData();
      formData.append("thread_id", threadId);
      formData.append("message", interruptMessage);
      
      const response = await fetch("http://localhost:8000/data-analysis/interrupt", {
        method: "POST",
        body: formData
      });
      
      const data = await response.json();
      if (data.status === "interrupted") {
        setHistory(prev => [...prev, 
          { role: "user", content: `Interrupt: ${interruptMessage}` }
        ]);
        setInterruptMessage("");
        alert("Interrupt message sent. The workflow will incorporate your feedback.");
      }
    } catch (err) {
      alert("Failed to send interrupt: " + err.message);
    }
  };

  const handleApprove = async () => {
    setUiState("finalize");
    setCurrentStage("finalize");
    setFinalReport("");
    finalRef.current = "";
    
    try {
      await AssistantService.resumeDataAnalysis({
        thread_id: threadId,
        review_action: "approved"
      });
      
      eventSourceRef.current = AssistantService.streamDataAnalysis(
        threadId,
        (data) => {
          if (data.node === "finalize" && data.content) {
            finalRef.current += data.content;
            setFinalReport(finalRef.current);
          } else if (data.status === "finished") {
            setUiState("finished");
            setCurrentStage(null);
            if (data.final_output) {
              setFinalReport(data.final_output);
            }
            if (data.visualization_path) {
              setVisualizationPath(data.visualization_path);
            }
            if (eventSourceRef.current) {
              eventSourceRef.current.close();
            }
          }
        },
        (error) => {
          console.error("Error:", error);
          alert("Error: " + error.message);
        },
        () => {
          console.log("Stream completed");
        }
      );
    } catch (err) {
      alert("Failed to approve: " + err.message);
    }
  };

  const handleFeedback = async () => {
    if (!feedback.trim()) return;
    
    const newRevisionCount = revisionCount + 1;
    setRevisionCount(newRevisionCount);
    setUiState("generating");
    setCurrentStage("code_generation");
    setGeneratedCode("");
    codeRef.current = "";
    
    setHistory(prev => [...prev, 
      { role: "user", content: `Feedback (Revision ${newRevisionCount}): ${feedback}` }
    ]);
    
    try {
      await AssistantService.resumeDataAnalysis({
        thread_id: threadId,
        review_action: "feedback",
        human_comment: feedback
      });
      
      eventSourceRef.current = AssistantService.streamDataAnalysis(
        threadId,
        (data) => {
          if (data.node === "code_generation" && data.content) {
            codeRef.current += data.content;
            setGeneratedCode(codeRef.current);
          } else if (data.status === "user_feedback" || data.status === "code_review") {
            setUiState("review");
            setCurrentStage("review");
            if (eventSourceRef.current) {
              eventSourceRef.current.close();
            }
          }
        },
        (error) => {
          console.error("Error:", error);
          alert("Error: " + error.message);
        },
        () => {
          console.log("Stream completed");
        }
      );
      
      setFeedback("");
    } catch (err) {
      alert("Failed to submit feedback: " + err.message);
    }
  };

  const resetSession = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setUiState("idle");
    setCurrentStage(null);
    setQuery("");
    setSelectedFile(null);
    setFilePath(null);
    setFileName(null);
    setDataSummary("");
    setAnalysisPlan("");
    setGeneratedCode("");
    setExecutionResults("");
    setVisualizationPath(null);
    setFinalReport("");
    setFeedback("");
    setInterruptMessage("");
    setThreadId(null);
    setRevisionCount(0);
    setHistory([]);
  };

  const getStageLabel = (stage) => {
    const labels = {
      data_exploration: "🔍 Data Exploration",
      analysis_planning: "📋 Analysis Planning",
      code_generation: "💻 Code Generation",
      code_execution: "⚙️ Code Execution",
      visualization_generation: "📊 Visualization Generation",
      review: "👤 Human Review (HITL)",
      finalize: "✨ Finalization",
      finished: "✅ Complete"
    };
    return labels[stage] || stage;
  };

  const getVisualizationUrl = (path) => {
    if (!path) return null;
    const filename = path.split(/[/\\]/).pop();
    return `http://localhost:8000/data-analysis/visualization/${filename}`;
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <img src="/hitl-assistent.png" alt="HITL Graph" className="sidebar-image" />
        <div className="sidebar-title">Data Analysis Workflow</div>
        <div className="sidebar-desc">
          CSV Analysis with Code Generation & Visualization
        </div>
        <div className="workflow-stages">
          <div className={`stage-indicator ${currentStage === "data_exploration" ? "active" : ""} ${["analysis_planning", "code_generation", "code_execution", "visualization_generation", "review", "finalize", "finished"].includes(currentStage) ? "completed" : ""}`}>
            <span>1. Data Exploration</span>
          </div>
          <div className={`stage-indicator ${currentStage === "analysis_planning" ? "active" : ""} ${["code_generation", "code_execution", "visualization_generation", "review", "finalize", "finished"].includes(currentStage) ? "completed" : ""}`}>
            <span>2. Analysis Planning</span>
          </div>
          <div className={`stage-indicator ${currentStage === "code_generation" ? "active" : ""} ${["code_execution", "visualization_generation", "review", "finalize", "finished"].includes(currentStage) ? "completed" : ""}`}>
            <span>3. Code Generation</span>
          </div>
          <div className={`stage-indicator ${currentStage === "code_execution" ? "active" : ""} ${["visualization_generation", "review", "finalize", "finished"].includes(currentStage) ? "completed" : ""}`}>
            <span>4. Code Execution</span>
          </div>
          <div className={`stage-indicator ${currentStage === "visualization_generation" ? "active" : ""} ${["review", "finalize", "finished"].includes(currentStage) ? "completed" : ""}`}>
            <span>5. Visualization</span>
          </div>
          <div className={`stage-indicator ${currentStage === "review" ? "active" : ""} ${["finalize", "finished"].includes(currentStage) ? "completed" : ""}`}>
            <span>6. Review (HITL)</span>
          </div>
          <div className={`stage-indicator ${currentStage === "finalize" ? "active" : ""} ${currentStage === "finished" ? "completed" : ""}`}>
            <span>7. Finalize</span>
          </div>
        </div>
      </div>
      
      <div className="chat-container">
        <div className="chat-header">
          <h2>Data Analysis Demo</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button onClick={resetSession} className="btn-secondary">
              New Session
            </button>
          </div>
        </div>

        {currentStage && (
          <div className="stage-banner">
            <strong>{getStageLabel(currentStage)}</strong>
            {currentStage === "review" && (
              <span className="hitl-badge">⏸️ PAUSED FOR HUMAN INPUT</span>
            )}
          </div>
        )}

        <div className="messages-area">
          {history.length === 0 && uiState === "idle" && (
            <div style={{ textAlign: 'center', marginTop: '4rem', color: 'var(--text-secondary)' }}>
              <p>Upload a CSV file and enter an analysis query</p>
              <p style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
                Example: "Analyze stock price trends" or "Find correlations in car prices"
              </p>
            </div>
          )}

          {history.map((msg, idx) => (
            <div key={idx} className={`message ${msg.role}`}>
              <div className="message-label">
                {msg.role === "user" ? "You" : "Assistant"}
              </div>
              <div className="message-content">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            </div>
          ))}

          {dataSummary && (
            <div className="stage-content research-stage">
              <div className="stage-header">🔍 Data Exploration</div>
              <ReactMarkdown>{dataSummary}</ReactMarkdown>
            </div>
          )}

          {analysisPlan && (
            <div className="stage-content draft-stage">
              <div className="stage-header">📋 Analysis Plan</div>
              <ReactMarkdown>{analysisPlan}</ReactMarkdown>
            </div>
          )}

          {generatedCode && (
            <div className="stage-content draft-stage">
              <div className="stage-header">💻 Generated Code {revisionCount > 0 && `(Revision ${revisionCount + 1})`}</div>
              <pre style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '4px', overflow: 'auto' }}>
                <code>{generatedCode}</code>
              </pre>
            </div>
          )}

          {executionResults && (
            <div className="stage-content draft-stage">
              <div className="stage-header">⚙️ Execution Results</div>
              <pre style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '4px', overflow: 'auto' }}>
                <code>{executionResults}</code>
              </pre>
            </div>
          )}

          {visualizationPath && (
            <div className="stage-content draft-stage">
              <div className="stage-header">📊 Visualization</div>
              <img 
                src={getVisualizationUrl(visualizationPath)} 
                alt="Data Visualization" 
                style={{ maxWidth: '100%', height: 'auto', marginTop: '1rem' }}
              />
            </div>
          )}

          {finalReport && uiState === "finished" && (
            <div className="stage-content finalize-stage">
              <div className="stage-header">✨ Final Report</div>
              <ReactMarkdown>{finalReport}</ReactMarkdown>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        <div className="input-area">
          {uiState === "idle" && (
            <div>
              <div className="input-group" style={{ marginBottom: '1rem' }}>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelect}
                  style={{ padding: '0.5rem' }}
                />
                {fileName && (
                  <span style={{ marginLeft: '0.5rem', color: 'var(--text-secondary)' }}>
                    Selected: {fileName}
                  </span>
                )}
              </div>
              <div className="input-group">
                <input
                  type="text"
                  placeholder="Enter your analysis query (e.g., 'Analyze stock trends' or 'Find car price correlations')..."
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleStart(); }}
                  className="chat-input"
                  autoFocus
                />
                <button onClick={handleStart} className="btn-primary">Start Analysis</button>
              </div>
            </div>
          )}

          {(uiState === "exploring" || uiState === "planning" || uiState === "generating" || uiState === "executing" || uiState === "visualizing") && (
            <div className="input-group">
              <input
                type="text"
                placeholder="Send interrupt message during generation..."
                value={interruptMessage}
                onChange={e => setInterruptMessage(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleInterrupt(); }}
                className="chat-input"
              />
              <button onClick={handleInterrupt} className="btn-secondary" disabled={!interruptMessage.trim()}>
                Send Interrupt
              </button>
            </div>
          )}

          {uiState === "review" && (
            <div className="feedback-form">
              <div className="feedback-title">⏸️ Human Review - Provide Feedback or Approve</div>
              <textarea
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                className="feedback-textarea"
                placeholder="Enter your feedback to improve the analysis..."
              />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={handleFeedback} className="btn-primary" disabled={!feedback.trim()}>
                  Submit Feedback
                </button>
                <button onClick={handleApprove} className="btn-primary">
                  Approve & Finalize
                </button>
              </div>
            </div>
          )}

          {uiState === "finished" && (
            <div className="action-area">
              <button onClick={resetSession} className="btn-primary">
                Start New Analysis
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DataAnalysisDemo;


