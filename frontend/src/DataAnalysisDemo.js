import React, { useState, useRef, useEffect } from "react";
import AssistantService from "./AssistantService";
import ReactMarkdown from "react-markdown";
import "./App.css";

const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

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
  const [visualizationPaths, setVisualizationPaths] = useState([]);
  const [finalReport, setFinalReport] = useState("");
  
  const [feedback, setFeedback] = useState("");
  const [interruptMessage, setInterruptMessage] = useState("");
  const [threadId, setThreadId] = useState(null);
  const [revisionCount, setRevisionCount] = useState(0);
  const [history, setHistory] = useState([]);
  const [isRunningCode, setIsRunningCode] = useState(false);
  const [manualExecutionResults, setManualExecutionResults] = useState("");
  const [isFixingCode, setIsFixingCode] = useState(false);
  const [fixedCode, setFixedCode] = useState(null);
  
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
      
      const response = await fetch(`${BASE_URL}/data-analysis/upload`, {
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
      
      const response = await fetch(`${BASE_URL}/data-analysis/start`, {
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
            if (data.visualization_paths && Array.isArray(data.visualization_paths)) {
              setVisualizationPaths(data.visualization_paths);
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
            if (data.visualization_paths && Array.isArray(data.visualization_paths)) {
              setVisualizationPaths(data.visualization_paths);
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
      
      const response = await fetch(`${BASE_URL}/data-analysis/interrupt`, {
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
            if (data.visualization_paths && Array.isArray(data.visualization_paths)) {
              setVisualizationPaths(data.visualization_paths);
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
    setVisualizationPaths([]);
    setFinalReport("");
    setFeedback("");
    setInterruptMessage("");
    setThreadId(null);
    setRevisionCount(0);
    setHistory([]);
    setManualExecutionResults("");
    setIsRunningCode(false);
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
    return `${BASE_URL}/data-analysis/visualization/${filename}`;
  };

  const handleCopyCode = async () => {
    if (!generatedCode) return;
    
    try {
      await navigator.clipboard.writeText(generatedCode);
      // Show temporary feedback
      const copyBtn = document.querySelector('.copy-code-btn');
      if (copyBtn) {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = '✓ Copied!';
        copyBtn.style.backgroundColor = 'var(--success-color)';
        setTimeout(() => {
          copyBtn.textContent = originalText;
          copyBtn.style.backgroundColor = '';
        }, 2000);
      }
    } catch (err) {
      alert("Failed to copy code: " + err.message);
    }
  };

  const handleRunCode = async (autoFix = true) => {
    if (!generatedCode) return;
    
    setIsRunningCode(true);
    setIsFixingCode(false);
    setManualExecutionResults("");
    setFixedCode(null);
    
    try {
      const result = await AssistantService.executeCode(
        generatedCode, 
        filePath, 
        autoFix,  // Enable auto-fix by default
        query     // Pass original query for context
      );
      
      if (result.success) {
        let output = result.output || "Code executed successfully (no output).";
        if (result.fixed) {
          output = "✅ Code was automatically fixed and executed!\n\n" + output;
          if (result.fixed_code) {
            setFixedCode(result.fixed_code);
            setGeneratedCode(result.fixed_code); // Update the code with fixed version
          }
        }
        setManualExecutionResults(output);
      } else {
        let errorMsg = result.error || "Unknown error occurred.";
        if (result.fixed && result.fixed_code) {
          // AI tried to fix but still failed
          errorMsg = "⚠️ Attempted to auto-fix but error persists:\n\n" + errorMsg;
          setFixedCode(result.fixed_code);
        } else if (!autoFix) {
          // Error occurred, suggest auto-fix
          errorMsg = errorMsg + "\n\n💡 Tip: The code will be automatically fixed on next run.";
        }
        setManualExecutionResults(errorMsg);
      }
    } catch (err) {
      setManualExecutionResults("Error: " + err.message);
    } finally {
      setIsRunningCode(false);
      setIsFixingCode(false);
    }
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
              <div className="stage-header">
                💻 Generated Code {revisionCount > 0 && `(Revision ${revisionCount + 1})`}
              </div>
              <div style={{ position: 'relative', marginTop: '0.5rem' }}>
                {/* ChatGPT-like code block with copy button in top-right */}
                <div style={{ 
                  position: 'relative',
                  background: '#1e1e1e',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  border: '1px solid var(--border-color)'
                }}>
                  {/* Copy and Run buttons in top-right corner */}
                  <div style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    display: 'flex',
                    gap: '0.5rem',
                    zIndex: 10
                  }}>
                    <button 
                      onClick={handleCopyCode}
                      className="copy-code-btn"
                      style={{
                        padding: '0.375rem 0.75rem',
                        background: 'rgba(255, 255, 255, 0.1)',
                        color: '#fff',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        transition: 'all 0.2s',
                        backdropFilter: 'blur(10px)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem'
                      }}
                      onMouseOver={(e) => {
                        e.target.style.background = 'rgba(255, 255, 255, 0.2)';
                        e.target.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                      }}
                      onMouseOut={(e) => {
                        e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                        e.target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                      }}
                    >
                      <span>📋</span> Copy
                    </button>
                    <button 
                      onClick={() => handleRunCode(true)}
                      disabled={isRunningCode || isFixingCode}
                      className="run-code-btn"
                      style={{
                        padding: '0.375rem 0.75rem',
                        background: (isRunningCode || isFixingCode) ? 'rgba(255, 255, 255, 0.1)' : 'rgba(16, 185, 129, 0.8)',
                        color: '#fff',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '6px',
                        cursor: (isRunningCode || isFixingCode) ? 'not-allowed' : 'pointer',
                        fontSize: '0.75rem',
                        transition: 'all 0.2s',
                        backdropFilter: 'blur(10px)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        opacity: (isRunningCode || isFixingCode) ? 0.7 : 1
                      }}
                      onMouseOver={(e) => {
                        if (!isRunningCode && !isFixingCode) {
                          e.target.style.background = 'rgba(16, 185, 129, 1)';
                          e.target.style.borderColor = 'rgba(16, 185, 129, 0.5)';
                        }
                      }}
                      onMouseOut={(e) => {
                        if (!isRunningCode && !isFixingCode) {
                          e.target.style.background = 'rgba(16, 185, 129, 0.8)';
                          e.target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                        }
                      }}
                    >
                      {isFixingCode ? '🔧 Fixing...' : isRunningCode ? '⏳ Running...' : '▶️ Run'}
                    </button>
                  </div>
                  <pre style={{ 
                    background: '#1e1e1e',
                    padding: '2.5rem 1rem 1rem 1rem',
                    margin: 0,
                    borderRadius: '8px',
                    overflow: 'auto',
                    color: '#d4d4d4',
                    fontSize: '0.875rem',
                    lineHeight: '1.5',
                    fontFamily: 'Consolas, Monaco, "Courier New", monospace'
                  }}>
                    <code style={{ color: '#d4d4d4' }}>{generatedCode}</code>
                  </pre>
                </div>
              </div>
              {manualExecutionResults && (
                <div className="stage-content draft-stage" style={{ marginTop: '1rem' }}>
                  <div className="stage-header">
                    ⚙️ Execution Results (Manual Run)
                    {fixedCode && (
                      <span style={{ 
                        marginLeft: '1rem', 
                        fontSize: '0.75rem', 
                        color: 'var(--success-color)',
                        fontWeight: 'normal'
                      }}>
                        ✅ Code was auto-fixed
                      </span>
                    )}
                  </div>
                  <pre style={{ 
                    background: manualExecutionResults.includes('Error') || manualExecutionResults.includes('error') 
                      ? 'rgba(239, 68, 68, 0.1)' 
                      : 'var(--bg-secondary)', 
                    padding: '1rem', 
                    borderRadius: '4px', 
                    overflow: 'auto',
                    border: manualExecutionResults.includes('Error') || manualExecutionResults.includes('error')
                      ? '1px solid rgba(239, 68, 68, 0.3)'
                      : '1px solid var(--border-color)'
                  }}>
                    <code style={{ 
                      color: manualExecutionResults.includes('Error') || manualExecutionResults.includes('error')
                        ? 'var(--error-color)'
                        : 'inherit'
                    }}>
                      {manualExecutionResults}
                    </code>
                  </pre>
                </div>
              )}
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

          {(visualizationPath || visualizationPaths.length > 0) && (
            <div className="stage-content draft-stage">
              <div className="stage-header">📊 Data Visualizations</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1rem' }}>
                {/* Display single visualization path if exists */}
                {visualizationPath && (
                  <div style={{ 
                    border: '1px solid var(--border-color)', 
                    borderRadius: '8px', 
                    padding: '1rem',
                    background: 'var(--bg-secondary)'
                  }}>
                    <img 
                      src={getVisualizationUrl(visualizationPath)} 
                      alt="Data Visualization" 
                      style={{ 
                        maxWidth: '100%', 
                        height: 'auto',
                        borderRadius: '4px',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                      }}
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.parentElement.innerHTML = '<p style="color: var(--error-color);">Failed to load visualization</p>';
                      }}
                    />
                  </div>
                )}
                {/* Display multiple visualizations if available */}
                {visualizationPaths.map((path, idx) => (
                  <div key={idx} style={{ 
                    border: '1px solid var(--border-color)', 
                    borderRadius: '8px', 
                    padding: '1rem',
                    background: 'var(--bg-secondary)'
                  }}>
                    <img 
                      src={getVisualizationUrl(path)} 
                      alt={`Data Visualization ${idx + 1}`}
                      style={{ 
                        maxWidth: '100%', 
                        height: 'auto',
                        borderRadius: '4px',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                      }}
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.parentElement.innerHTML = '<p style="color: var(--error-color);">Failed to load visualization</p>';
                      }}
                    />
                  </div>
                ))}
              </div>
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


