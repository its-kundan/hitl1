import React, { useState, useRef, useEffect } from "react";
import AssistantService from "./AssistantService";
import ReactMarkdown from "react-markdown";
import "./App.css";

const UnifiedWorkflowDemo = () => {
  const [workflowType, setWorkflowType] = useState("basic");
  const [uiState, setUiState] = useState("idle");
  const [userQuery, setUserQuery] = useState("");
  const [assistantResponse, setAssistantResponse] = useState("");
  const [feedback, setFeedback] = useState("");
  const [threadId, setThreadId] = useState(null);
  const [history, setHistory] = useState([]);
  const [errorMessage, setErrorMessage] = useState(null);
  const [currentNode, setCurrentNode] = useState("");
  const [file, setFile] = useState(null);
  const [filePath, setFilePath] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [interruptMessage, setInterruptMessage] = useState("");
  const [code, setCode] = useState("");
  const [visualizationPath, setVisualizationPath] = useState("");
  const [visualizationPaths, setVisualizationPaths] = useState([]);
  const [analysisPlan, setAnalysisPlan] = useState("");
  const [sentences, setSentences] = useState({});
  const [editingSentenceId, setEditingSentenceId] = useState(null);
  const [editingSentenceText, setEditingSentenceText] = useState("");
  const [revisionCount, setRevisionCount] = useState(0);
  
  const accumulatedResponseRef = useRef("");
  const feedbackInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const eventSourceRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, assistantResponse, uiState]);

  // Focus feedback input when needed
  useEffect(() => {
    if (uiState === "feedback_form" && feedbackInputRef.current) {
      feedbackInputRef.current.focus();
    }
  }, [uiState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const handleFileChange = async (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      try {
        const result = await AssistantService.uploadFile(selectedFile);
        setFilePath(result.file_path);
        setFileName(result.file_name);
      } catch (error) {
        alert("Error uploading file: " + error.message);
      }
    }
  };

  const handleStart = async () => {
    if (!userQuery.trim()) return;

    // Validate file requirement for data analysis
    if (workflowType === "data_analysis" && !filePath) {
      alert("Please upload a CSV file for data analysis");
      return;
    }

    setUiState("waiting");
    setHistory([
      { role: "user", content: userQuery },
      { role: "assistant", content: null }
    ]);
    setErrorMessage(null);
    setAssistantResponse("");
    setCurrentNode("");
    accumulatedResponseRef.current = "";

    try {
      const data = await AssistantService.startUnifiedWorkflow(
        workflowType,
        userQuery,
        filePath,
        fileName
      );
      setThreadId(data.thread_id);

      // Start streaming
      eventSourceRef.current = AssistantService.streamUnifiedWorkflow(
        data.thread_id,
        (messageData) => {
          if (messageData.content) {
            accumulatedResponseRef.current += messageData.content;
            setAssistantResponse(accumulatedResponseRef.current);
            setCurrentNode(messageData.node || "");
            
            setHistory([
              { role: "user", content: userQuery },
              { role: "assistant", content: accumulatedResponseRef.current }
            ]);
          } else if (messageData.status) {
            handleStatusUpdate(messageData);
          } else if (messageData.event === 'start') {
            setCurrentNode("Starting...");
          }
        },
        (error) => {
          console.error("Streaming error:", error);
          setUiState("idle");
          setErrorMessage(error.message);
          alert("Streaming error: " + error.message);
        },
        () => {
          console.log("Stream completed");
        }
      );
    } catch (err) {
      setAssistantResponse("");
      setUiState("idle");
      setErrorMessage(err.message);
      alert("Failed to start workflow: " + err.message);
    }
  };

  const handleStatusUpdate = (data) => {
    if (data.status === "user_feedback") {
      setUiState("idle");
      if (data.assistant_response) {
        setAssistantResponse(data.assistant_response);
      }
      if (data.draft_content) {
        setAssistantResponse(data.draft_content);
      }
    } else if (data.status === "code_review") {
      setUiState("code_review");
      setAnalysisPlan(data.analysis_plan || "");
    } else if (data.status === "editing") {
      setUiState("editing");
      setAssistantResponse(data.current_content || "");
      setSentences(data.sentences || {});
      setRevisionCount(data.revision_count || 0);
    } else if (data.status === "finished") {
      setUiState("finished");
      if (data.final_output) {
        setAssistantResponse(data.final_output);
      }
      if (data.code) {
        setCode(data.code);
      }
      if (data.visualization_path) {
        setVisualizationPath(data.visualization_path);
      }
      if (data.visualization_paths) {
        setVisualizationPaths(data.visualization_paths);
      }
    }
  };

  const handleApprove = async () => {
    setUiState("waiting");
    setHistory([...history, { role: "assistant", content: null }]);

    try {
      const data = await AssistantService.resumeUnifiedWorkflow({
        thread_id: threadId,
        workflow_type: workflowType,
        action: "approved"
      });

      accumulatedResponseRef.current = "";

      eventSourceRef.current = AssistantService.streamUnifiedWorkflow(
        threadId,
        (messageData) => {
          if (messageData.content) {
            accumulatedResponseRef.current += messageData.content;
            setAssistantResponse(accumulatedResponseRef.current);
            setCurrentNode(messageData.node || "");
            
            setHistory(prev => [
              ...prev.slice(0, -1),
              { role: "assistant", content: accumulatedResponseRef.current }
            ]);
          } else if (messageData.status) {
            handleStatusUpdate(messageData);
          }
        },
        (error) => {
          console.error("Streaming error:", error);
          setUiState("idle");
          setErrorMessage(error.message);
        },
        () => {
          console.log("Stream completed");
        }
      );
    } catch (err) {
      setUiState("idle");
      setErrorMessage(err.message);
      alert("Failed to resume workflow: " + err.message);
    }
  };

  const handleFeedback = async () => {
    if (!feedback.trim()) {
      alert("Please provide feedback");
      return;
    }

    setUiState("waiting");
    setHistory([...history, { role: "user", content: `Feedback: ${feedback}` }, { role: "assistant", content: null }]);

    try {
      const data = await AssistantService.resumeUnifiedWorkflow({
        thread_id: threadId,
        workflow_type: workflowType,
        action: "feedback",
        human_comment: feedback
      });

      setFeedback("");
      accumulatedResponseRef.current = "";

      eventSourceRef.current = AssistantService.streamUnifiedWorkflow(
        threadId,
        (messageData) => {
          if (messageData.content) {
            accumulatedResponseRef.current += messageData.content;
            setAssistantResponse(accumulatedResponseRef.current);
            setCurrentNode(messageData.node || "");
            
            setHistory(prev => [
              ...prev.slice(0, -1),
              { role: "assistant", content: accumulatedResponseRef.current }
            ]);
          } else if (messageData.status) {
            handleStatusUpdate(messageData);
          }
        },
        (error) => {
          console.error("Streaming error:", error);
          setUiState("idle");
          setErrorMessage(error.message);
        },
        () => {
          console.log("Stream completed");
        }
      );
    } catch (err) {
      setUiState("idle");
      setErrorMessage(err.message);
      alert("Failed to submit feedback: " + err.message);
    }
  };

  const handleInterrupt = async () => {
    if (!interruptMessage.trim()) {
      alert("Please enter an interrupt message");
      return;
    }

    try {
      await AssistantService.interruptWorkflow(threadId, interruptMessage);
      setInterruptMessage("");
      alert("Interrupt message sent!");
    } catch (err) {
      alert("Failed to send interrupt: " + err.message);
    }
  };

  const handleEditSentence = (sentenceId) => {
    setEditingSentenceId(sentenceId);
    setEditingSentenceText(sentences[sentenceId] || "");
  };

  const handleSaveSentence = () => {
    if (!editingSentenceId || !editingSentenceText.trim()) return;

    // Update local state immediately
    setSentences(prev => ({
      ...prev,
      [editingSentenceId]: editingSentenceText
    }));
    setEditingSentenceId(null);
    setEditingSentenceText("");
  };

  const handleResumeEditing = async () => {
    setUiState("waiting");

    try {
      const data = await AssistantService.resumeUnifiedWorkflow({
        thread_id: threadId,
        workflow_type: workflowType,
        action: "editing",
        edited_sentences: sentences
      });

      accumulatedResponseRef.current = "";

      eventSourceRef.current = AssistantService.streamUnifiedWorkflow(
        threadId,
        (messageData) => {
          if (messageData.content) {
            accumulatedResponseRef.current += messageData.content;
            setAssistantResponse(accumulatedResponseRef.current);
            setCurrentNode(messageData.node || "");
          } else if (messageData.status) {
            handleStatusUpdate(messageData);
          }
        },
        (error) => {
          console.error("Streaming error:", error);
          setUiState("idle");
          setErrorMessage(error.message);
        },
        () => {
          console.log("Stream completed");
        }
      );
    } catch (err) {
      setUiState("idle");
      setErrorMessage(err.message);
      alert("Failed to resume editing: " + err.message);
    }
  };

  const handleNewSession = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    setUiState("idle");
    setUserQuery("");
    setAssistantResponse("");
    setFeedback("");
    setThreadId(null);
    setHistory([]);
    setErrorMessage(null);
    setCurrentNode("");
    setFile(null);
    setFilePath(null);
    setFileName(null);
    setInterruptMessage("");
    setCode("");
    setVisualizationPath("");
    setVisualizationPaths([]);
    setAnalysisPlan("");
    setSentences({});
    setEditingSentenceId(null);
    setEditingSentenceText("");
    setRevisionCount(0);
    accumulatedResponseRef.current = "";
  };

  const getVisualizationUrl = (path) => {
    if (!path) return null;
    const filename = path.split('/').pop();
    return `${process.env.REACT_APP_API_URL || "http://localhost:8000"}/unified/visualization/${filename}`;
  };

  return (
    <div className="unified-workflow-demo">
      <div className="workflow-header">
        <h2>Unified Interactive Workflow</h2>
        <div className="workflow-selector">
          <label>Workflow Type: </label>
          <select 
            value={workflowType} 
            onChange={(e) => {
              setWorkflowType(e.target.value);
              handleNewSession();
            }}
            disabled={uiState !== "idle" && uiState !== "finished"}
          >
            <option value="basic">Basic HITL</option>
            <option value="custom">Custom Workflow (4-Stage)</option>
            <option value="data_analysis">Data Analysis (CSV)</option>
            <option value="editable">Editable Content</option>
            <option value="mcp">MCP Tools (Coming Soon)</option>
          </select>
        </div>
        {threadId && (
          <button onClick={handleNewSession} className="new-session-btn">
            New Session
          </button>
        )}
      </div>

      {errorMessage && (
        <div className="error-message">
          Error: {errorMessage}
        </div>
      )}

      {currentNode && (
        <div className="current-node">
          <strong>Current Stage:</strong> {currentNode}
        </div>
      )}

      {workflowType === "data_analysis" && (
        <div className="file-upload-section">
          <label>
            Upload CSV File:
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              disabled={uiState !== "idle" && uiState !== "finished"}
            />
          </label>
          {fileName && <span className="file-name">✓ {fileName}</span>}
        </div>
      )}

      <div className="input-section">
        <textarea
          value={userQuery}
          onChange={(e) => setUserQuery(e.target.value)}
          placeholder={
            workflowType === "data_analysis"
              ? "Enter your data analysis query (e.g., 'Analyze stock price trends')"
              : workflowType === "custom"
              ? "Enter your query (e.g., 'Write a blog post about renewable energy')"
              : workflowType === "editable"
              ? "Enter your query (e.g., 'Write an article about AI')"
              : "Enter your question or request"
          }
          disabled={uiState !== "idle" && uiState !== "finished"}
          rows={3}
        />
        <button
          onClick={handleStart}
          disabled={(uiState !== "idle" && uiState !== "finished") || !userQuery.trim()}
        >
          {workflowType === "data_analysis" ? "Start Analysis" : "Start"}
        </button>
      </div>

      {uiState === "waiting" && workflowType === "data_analysis" && (
        <div className="interrupt-section">
          <input
            type="text"
            value={interruptMessage}
            onChange={(e) => setInterruptMessage(e.target.value)}
            placeholder="Send interrupt message during generation..."
            onKeyPress={(e) => e.key === "Enter" && handleInterrupt()}
          />
          <button onClick={handleInterrupt}>Send Interrupt</button>
        </div>
      )}

      {uiState === "code_review" && (
        <div className="code-review-section">
          <h3>Analysis Plan</h3>
          <div className="analysis-plan">
            <ReactMarkdown>{analysisPlan}</ReactMarkdown>
          </div>
          <div className="action-buttons">
            <button onClick={handleApprove}>Approve & Continue</button>
            <button onClick={() => setUiState("idle")}>Cancel</button>
          </div>
        </div>
      )}

      {uiState === "editing" && (
        <div className="editing-section">
          <h3>Edit Content (Revision {revisionCount + 1})</h3>
          <div className="sentences-list">
            {Object.entries(sentences).map(([id, text]) => (
              <div key={id} className="sentence-item">
                {editingSentenceId === id ? (
                  <div className="sentence-editor">
                    <textarea
                      value={editingSentenceText}
                      onChange={(e) => setEditingSentenceText(e.target.value)}
                      rows={2}
                    />
                    <div className="sentence-actions">
                      <button onClick={handleSaveSentence}>Save</button>
                      <button onClick={() => {
                        setEditingSentenceId(null);
                        setEditingSentenceText("");
                      }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="sentence-display">
                    <span>{text}</span>
                    <button onClick={() => handleEditSentence(id)}>Edit</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="action-buttons">
            <button onClick={handleResumeEditing}>Continue with Edits</button>
            <button onClick={handleApprove}>Approve as Is</button>
          </div>
        </div>
      )}

      <div className="messages-container">
        {history.map((msg, idx) => (
          <div key={idx} className={`message ${msg.role}`}>
            <div className="message-role">{msg.role === "user" ? "You" : "Assistant"}</div>
            <div className="message-content">
              {msg.content === null ? (
                <div className="spinner">Generating...</div>
              ) : (
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {assistantResponse && (uiState === "idle" || uiState === "finished") && (
        <div className="response-section">
          <h3>Response</h3>
          <div className="response-content">
            <ReactMarkdown>{assistantResponse}</ReactMarkdown>
          </div>
        </div>
      )}

      {code && (
        <div className="code-section">
          <h3>Generated Code</h3>
          <pre><code>{code}</code></pre>
        </div>
      )}

      {visualizationPath && (
        <div className="visualization-section">
          <h3>Visualization</h3>
          <img src={getVisualizationUrl(visualizationPath)} alt="Analysis visualization" />
        </div>
      )}

      {visualizationPaths && visualizationPaths.length > 0 && (
        <div className="visualization-section">
          <h3>Visualizations</h3>
          {visualizationPaths.map((path, idx) => (
            <img key={idx} src={getVisualizationUrl(path)} alt={`Visualization ${idx + 1}`} />
          ))}
        </div>
      )}

      {uiState === "idle" && assistantResponse && (
        <div className="feedback-section">
          <h3>Review & Feedback</h3>
          <textarea
            ref={feedbackInputRef}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Provide feedback to improve the response..."
            rows={4}
          />
          <div className="action-buttons">
            <button onClick={handleApprove}>Approve</button>
            <button onClick={handleFeedback}>Submit Feedback</button>
          </div>
        </div>
      )}

      {uiState === "finished" && (
        <div className="finished-section">
          <p className="success-message">✓ Workflow completed successfully!</p>
        </div>
      )}
    </div>
  );
};

export default UnifiedWorkflowDemo;

