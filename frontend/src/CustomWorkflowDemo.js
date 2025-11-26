import React, { useState, useRef, useEffect } from "react";
import AssistantService from "./AssistantService";
import ReactMarkdown from "react-markdown";
import "./App.css";

const CustomWorkflowDemo = () => {
  const [uiState, setUiState] = useState("idle"); // idle, research, draft, review, finalize, finished
  const [currentStage, setCurrentStage] = useState(null);
  const [question, setQuestion] = useState("");
  const [researchContent, setResearchContent] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [finalContent, setFinalContent] = useState("");
  const [feedback, setFeedback] = useState("");
  const [threadId, setThreadId] = useState(null);
  const [revisionCount, setRevisionCount] = useState(0);
  const [history, setHistory] = useState([]);
  
  const researchRef = useRef("");
  const draftRef = useRef("");
  const finalizeRef = useRef("");
  const messagesEndRef = useRef(null);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, researchContent, draftContent, finalContent, uiState]);

  // Cleanup event source on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const handleStart = async () => {
    if (!question.trim()) return;

    setUiState("research");
    setCurrentStage("research");
    setResearchContent("");
    setDraftContent("");
    setFinalContent("");
    setRevisionCount(0);
    researchRef.current = "";
    draftRef.current = "";
    finalizeRef.current = "";
    
    setHistory([{ role: "user", content: question }]);
    
    try {
      const data = await AssistantService.createCustomWorkflow(question);
      setThreadId(data.thread_id);
      
      // Start streaming
      eventSourceRef.current = AssistantService.streamCustomWorkflow(
        data.thread_id,
        (data) => {
          if (data.node === "research" && data.content) {
            researchRef.current += data.content;
            setResearchContent(researchRef.current);
            setCurrentStage("research");
          } else if (data.node === "draft" && data.content) {
            draftRef.current += data.content;
            setDraftContent(draftRef.current);
            setCurrentStage("draft");
            setUiState("draft");
          } else if (data.node === "finalize" && data.content) {
            finalizeRef.current += data.content;
            setFinalContent(finalizeRef.current);
            setCurrentStage("finalize");
            setUiState("finalize");
          } else if (data.status === "user_feedback") {
            setUiState("review");
            setCurrentStage("review");
          } else if (data.status === "finished") {
            setUiState("finished");
            setCurrentStage(null);
            if (data.final_output) {
              setFinalContent(data.final_output);
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
      alert("Failed to start workflow: " + err.message);
      setUiState("idle");
    }
  };

  const handleApprove = async () => {
    setUiState("finalize");
    setCurrentStage("finalize");
    setFinalContent("");
    finalizeRef.current = "";
    
    try {
      await AssistantService.resumeCustomWorkflow({
        thread_id: threadId,
        review_action: "approved"
      });
      
      eventSourceRef.current = AssistantService.streamCustomWorkflow(
        threadId,
        (data) => {
          if (data.node === "finalize" && data.content) {
            finalizeRef.current += data.content;
            setFinalContent(finalizeRef.current);
          } else if (data.status === "finished") {
            setUiState("finished");
            setCurrentStage(null);
            if (data.final_output) {
              setFinalContent(data.final_output);
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
    setUiState("draft");
    setCurrentStage("draft");
    setDraftContent("");
    draftRef.current = "";
    
    setHistory(prev => [...prev, 
      { role: "user", content: `Feedback (Revision ${newRevisionCount}): ${feedback}` }
    ]);
    
    try {
      await AssistantService.resumeCustomWorkflow({
        thread_id: threadId,
        review_action: "feedback",
        human_comment: feedback
      });
      
      eventSourceRef.current = AssistantService.streamCustomWorkflow(
        threadId,
        (data) => {
          if (data.node === "draft" && data.content) {
            draftRef.current += data.content;
            setDraftContent(draftRef.current);
          } else if (data.status === "user_feedback") {
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
    setQuestion("");
    setResearchContent("");
    setDraftContent("");
    setFinalContent("");
    setFeedback("");
    setThreadId(null);
    setRevisionCount(0);
    setHistory([]);
  };

  const getStageLabel = (stage) => {
    const labels = {
      research: "🔍 Research Stage",
      draft: "✍️ Draft Stage",
      review: "👤 Human Review (HITL)",
      finalize: "✨ Finalize Stage",
      finished: "✅ Complete"
    };
    return labels[stage] || stage;
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <img src="/hitl-assistent.png" alt="HITL Graph" className="sidebar-image" />
        <div className="sidebar-title">Custom Gen AI Workflow</div>
        <div className="sidebar-desc">
          Multi-stage workflow with Human-in-the-Loop
        </div>
        <div className="workflow-stages">
          <div className={`stage-indicator ${currentStage === "research" ? "active" : ""} ${["draft", "review", "finalize", "finished"].includes(currentStage) ? "completed" : ""}`}>
            <span>1. Research</span>
          </div>
          <div className={`stage-indicator ${currentStage === "draft" ? "active" : ""} ${["review", "finalize", "finished"].includes(currentStage) && currentStage !== "draft" ? "completed" : ""}`}>
            <span>2. Draft</span>
          </div>
          <div className={`stage-indicator ${currentStage === "review" ? "active" : ""} ${["finalize", "finished"].includes(currentStage) ? "completed" : ""}`}>
            <span>3. Review (HITL)</span>
          </div>
          <div className={`stage-indicator ${currentStage === "finalize" ? "active" : ""} ${currentStage === "finished" ? "completed" : ""}`}>
            <span>4. Finalize</span>
          </div>
        </div>
      </div>
      
      <div className="chat-container">
        <div className="chat-header">
          <h2>Custom Workflow Demo</h2>
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
              <p>Enter a query to start the Gen AI workflow</p>
              <p style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
                Example: "Write a blog post about renewable energy"
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

          {researchContent && (
            <div className="stage-content research-stage">
              <div className="stage-header">🔍 Research Stage</div>
              <ReactMarkdown>{researchContent}</ReactMarkdown>
            </div>
          )}

          {draftContent && (
            <div className="stage-content draft-stage">
              <div className="stage-header">✍️ Draft Stage {revisionCount > 0 && `(Revision ${revisionCount + 1})`}</div>
              <ReactMarkdown>{draftContent}</ReactMarkdown>
            </div>
          )}

          {finalContent && uiState === "finished" && (
            <div className="stage-content finalize-stage">
              <div className="stage-header">✨ Final Output</div>
              <ReactMarkdown>{finalContent}</ReactMarkdown>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        <div className="input-area">
          {uiState === "idle" && (
            <div className="input-group">
              <input
                type="text"
                placeholder="Enter your query to start the workflow..."
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleStart(); }}
                className="chat-input"
                autoFocus
              />
              <button onClick={handleStart} className="btn-primary">Start Workflow</button>
            </div>
          )}

          {uiState === "review" && (
            <div className="feedback-form">
              <div className="feedback-title">⏸️ Human Review - Provide Feedback or Approve</div>
              <textarea
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                className="feedback-textarea"
                placeholder="Enter your feedback to improve the draft..."
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
                Start New Workflow
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CustomWorkflowDemo;


