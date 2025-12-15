import React, { useState, useRef, useEffect } from "react";
import AssistantService from "./AssistantService";
import ReactMarkdown from "react-markdown";
import "./App.css";

const EditableContentDemo = () => {
  const [uiState, setUiState] = useState("idle"); // idle, generating, editing, processing, finished
  const [question, setQuestion] = useState("");
  const [currentContent, setCurrentContent] = useState("");
  const [editableContent, setEditableContent] = useState(""); // Direct editable content
  const [isEditingDirectly, setIsEditingDirectly] = useState(false);
  const [sentences, setSentences] = useState({}); // sentence_id -> sentence_text
  const [editingSentence, setEditingSentence] = useState(null); // sentence_id being edited
  const [editText, setEditText] = useState("");
  const [sentenceFeedback, setSentenceFeedback] = useState({}); // sentence_id -> feedback
  const [generalFeedback, setGeneralFeedback] = useState(""); // General feedback for entire content
  const [threadId, setThreadId] = useState(null);
  const [revisionCount, setRevisionCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState(null);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  
  const contentRef = useRef("");
  const contentTextareaRef = useRef(null);
  const eventSourceRef = useRef(null);
  const contentContainerRef = useRef(null);

  // REMOVED auto-scroll - let user control scrolling manually
  // useEffect(() => {
  //   messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  // }, [currentContent, sentences, uiState]);

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

    setUiState("generating");
    setCurrentContent("");
    setEditableContent("");
    setSentences({});
    setEditingSentence(null);
    setEditText("");
    setSentenceFeedback({});
    setGeneralFeedback("");
    setRevisionCount(0);
    setErrorMessage(null);
    setIsEditingDirectly(false);
    setShowFeedbackForm(false);
    contentRef.current = "";
    
    try {
      const data = await AssistantService.createEditableWorkflow(question);
      setThreadId(data.thread_id);
      
      // Start streaming
      eventSourceRef.current = AssistantService.streamEditableWorkflow(
        data.thread_id,
        (data) => {
          if (data.content) {
            contentRef.current += data.content;
            const newContent = contentRef.current;
            setCurrentContent(newContent);
            setEditableContent(newContent);
            // Don't auto-scroll - let user read from beginning
          } else if (data.status === "editing") {
            setUiState("editing");
            const content = data.current_content || contentRef.current;
            setCurrentContent(content);
            setEditableContent(content);
            if (data.sentences) {
              setSentences(data.sentences);
            }
            if (data.revision_count !== undefined) {
              setRevisionCount(data.revision_count);
            }
            // Load sentences if not already loaded
            if (!Object.keys(sentences).length && content) {
              loadSentences();
            }
          } else if (data.status === "finished") {
            setUiState("finished");
            if (data.final_output) {
              setCurrentContent(data.final_output);
              setEditableContent(data.final_output);
            }
            if (eventSourceRef.current) {
              eventSourceRef.current.close();
            }
          }
        },
        (error) => {
          console.error("Error:", error);
          setErrorMessage("Error: " + error.message);
          setUiState("idle");
        },
        () => {
          console.log("Stream completed");
        }
      );
    } catch (err) {
      setErrorMessage("Failed to start workflow: " + err.message);
      setUiState("idle");
    }
  };

  const loadSentences = async () => {
    if (!threadId) return;
    
    try {
      const data = await AssistantService.getSentences(threadId);
      if (data.sentences) {
        setSentences(data.sentences);
        const content = data.current_content || currentContent;
        setCurrentContent(content);
        setEditableContent(content);
        setRevisionCount(data.revision_count || 0);
      }
    } catch (err) {
      console.error("Failed to load sentences:", err);
    }
  };

  const handleDirectEdit = () => {
    setIsEditingDirectly(true);
    setEditableContent(currentContent);
  };

  const handleSaveDirectEdit = () => {
    setCurrentContent(editableContent);
    setIsEditingDirectly(false);
    // Update sentences map from edited content
    const sentencesArray = editableContent.split(/[.!?]+/).filter(s => s.trim());
    const newSentences = {};
    sentencesArray.forEach((sentence, i) => {
      newSentences[`sentence_${i}`] = sentence.trim();
    });
    setSentences(newSentences);
  };

  const handleCancelDirectEdit = () => {
    setEditableContent(currentContent);
    setIsEditingDirectly(false);
  };

  const handleEditSentence = (sentenceId) => {
    setEditingSentence(sentenceId);
    setEditText(sentences[sentenceId] || "");
  };

  const handleSaveEdit = async () => {
    if (!threadId || !editingSentence) return;
    
    try {
      await AssistantService.editSentence(threadId, editingSentence, editText);
      // Update local state
      const updatedSentences = {
        ...sentences,
        [editingSentence]: editText
      };
      setSentences(updatedSentences);
      
      // Reconstruct content from updated sentences
      const updatedContent = Object.values(updatedSentences).join(" ");
      setCurrentContent(updatedContent);
      setEditableContent(updatedContent);
      
      setEditingSentence(null);
      setEditText("");
    } catch (err) {
      setErrorMessage("Failed to save edit: " + err.message);
    }
  };

  const handleCancelEdit = () => {
    setEditingSentence(null);
    setEditText("");
  };

  const handleFeedbackSentence = async (sentenceId) => {
    const feedback = prompt(`Provide feedback for this sentence:\n\n"${sentences[sentenceId]}"\n\nYour feedback:`);
    if (!feedback || !feedback.trim()) return;
    
    if (!threadId) return;
    
    try {
      await AssistantService.feedbackSentence(threadId, sentenceId, feedback);
      setSentenceFeedback(prev => ({
        ...prev,
        [sentenceId]: feedback
      }));
    } catch (err) {
      setErrorMessage("Failed to save feedback: " + err.message);
    }
  };

  const handleInstantFeedback = async () => {
    if (!generalFeedback.trim() || !threadId) return;
    
    setUiState("processing");
    setErrorMessage(null);
    
    try {
      // Send general feedback to improve content
      await AssistantService.resumeEditableWorkflow({
        thread_id: threadId,
        review_action: "feedback",
        human_comment: generalFeedback
      });
      
      // Start streaming the updated content
      contentRef.current = "";
      setGeneralFeedback("");
      setShowFeedbackForm(false);
      
      eventSourceRef.current = AssistantService.streamEditableWorkflow(
        threadId,
        (data) => {
          if (data.content) {
            contentRef.current += data.content;
            const newContent = contentRef.current;
            setCurrentContent(newContent);
            setEditableContent(newContent);
          } else if (data.status === "editing") {
            setUiState("editing");
            const content = data.current_content || contentRef.current;
            setCurrentContent(content);
            setEditableContent(content);
            if (data.sentences) {
              setSentences(data.sentences);
            }
            if (data.revision_count !== undefined) {
              setRevisionCount(data.revision_count);
            }
            setSentenceFeedback({}); // Clear feedback after processing
          } else if (data.status === "finished") {
            setUiState("finished");
            if (data.final_output) {
              setCurrentContent(data.final_output);
              setEditableContent(data.final_output);
            }
            if (eventSourceRef.current) {
              eventSourceRef.current.close();
            }
          }
        },
        (error) => {
          console.error("Error:", error);
          setErrorMessage("Error: " + error.message);
          setUiState("editing");
        },
        () => {
          console.log("Stream completed");
        }
      );
    } catch (err) {
      setErrorMessage("Failed to apply feedback: " + err.message);
      setUiState("editing");
    }
  };

  const handleIncorporateEdits = async () => {
    if (!threadId) return;
    
    setUiState("processing");
    setErrorMessage(null);
    
    try {
      // Collect all edits and feedback
      const editedSentences = {};
      const feedback = {};
      
      // Find sentences that were edited (different from original)
      Object.keys(sentences).forEach(sid => {
        if (sentenceFeedback[sid]) {
          feedback[sid] = sentenceFeedback[sid];
        }
      });
      
      await AssistantService.resumeEditableWorkflow({
        thread_id: threadId,
        review_action: "editing",
        edited_sentences: Object.keys(editedSentences).length ? editedSentences : undefined,
        sentence_feedback: Object.keys(feedback).length ? feedback : undefined,
        human_comment: generalFeedback || undefined
      });
      
      // Start streaming the updated content
      contentRef.current = "";
      setGeneralFeedback("");
      eventSourceRef.current = AssistantService.streamEditableWorkflow(
        threadId,
        (data) => {
          if (data.content) {
            contentRef.current += data.content;
            const newContent = contentRef.current;
            setCurrentContent(newContent);
            setEditableContent(newContent);
          } else if (data.status === "editing") {
            setUiState("editing");
            const content = data.current_content || contentRef.current;
            setCurrentContent(content);
            setEditableContent(content);
            if (data.sentences) {
              setSentences(data.sentences);
            }
            if (data.revision_count !== undefined) {
              setRevisionCount(data.revision_count);
            }
            setSentenceFeedback({}); // Clear feedback after processing
          } else if (data.status === "finished") {
            setUiState("finished");
            if (data.final_output) {
              setCurrentContent(data.final_output);
              setEditableContent(data.final_output);
            }
            if (eventSourceRef.current) {
              eventSourceRef.current.close();
            }
          }
        },
        (error) => {
          console.error("Error:", error);
          setErrorMessage("Error: " + error.message);
          setUiState("editing");
        },
        () => {
          console.log("Stream completed");
        }
      );
    } catch (err) {
      setErrorMessage("Failed to incorporate edits: " + err.message);
      setUiState("editing");
    }
  };

  const handleApprove = async () => {
    if (!threadId) return;
    
    setUiState("processing");
    setErrorMessage(null);
    
    try {
      await AssistantService.resumeEditableWorkflow({
        thread_id: threadId,
        review_action: "approved"
      });
      
      // Start streaming the finalized content
      contentRef.current = "";
      eventSourceRef.current = AssistantService.streamEditableWorkflow(
        threadId,
        (data) => {
          if (data.content) {
            contentRef.current += data.content;
            const newContent = contentRef.current;
            setCurrentContent(newContent);
            setEditableContent(newContent);
          } else if (data.status === "finished") {
            setUiState("finished");
            if (data.final_output) {
              setCurrentContent(data.final_output);
              setEditableContent(data.final_output);
            }
            if (eventSourceRef.current) {
              eventSourceRef.current.close();
            }
          }
        },
        (error) => {
          console.error("Error:", error);
          setErrorMessage("Error: " + error.message);
          setUiState("editing");
        },
        () => {
          console.log("Stream completed");
        }
      );
    } catch (err) {
      setErrorMessage("Failed to approve: " + err.message);
      setUiState("editing");
    }
  };

  const handleReset = () => {
    setUiState("idle");
    setQuestion("");
    setCurrentContent("");
    setEditableContent("");
    setSentences({});
    setEditingSentence(null);
    setEditText("");
    setSentenceFeedback({});
    setGeneralFeedback("");
    setThreadId(null);
    setRevisionCount(0);
    setErrorMessage(null);
    setIsEditingDirectly(false);
    setShowFeedbackForm(false);
    contentRef.current = "";
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  };

  // Auto-load sentences when entering editing mode
  useEffect(() => {
    if (uiState === "editing" && threadId && !Object.keys(sentences).length && currentContent) {
      loadSentences();
    }
  }, [uiState, threadId]);

  return (
    <div className="editable-content-demo">
      <h2>Sentence-Level Editable Content Workflow</h2>
      <p className="demo-description">
        Generate content and edit it directly or sentence-by-sentence. The AI will incorporate your edits
        and maintain consistency across the document. <strong>No auto-scroll - read and edit at your own pace!</strong>
      </p>

      {uiState === "idle" && (
        <div className="input-section">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Enter your request (e.g., 'Write a blog post about renewable energy')"
            rows={3}
            className="question-input"
          />
          <button onClick={handleStart} className="submit-button">
            Generate Content
          </button>
        </div>
      )}

      {(uiState === "generating" || uiState === "processing") && (
        <div className="loading-section">
          <div className="spinner"></div>
          <p>
            {uiState === "generating" ? "Generating initial content..." : "Processing your edits..."}
          </p>
        </div>
      )}

      {errorMessage && (
        <div className="error-message">
          {errorMessage}
          <button onClick={() => setErrorMessage(null)}>Dismiss</button>
        </div>
      )}

      {currentContent && (
        <div className="content-section" ref={contentContainerRef}>
          <div className="content-header">
            <h3>Current Content</h3>
            <div className="content-header-actions">
              {revisionCount > 0 && (
                <span className="revision-badge">Revision {revisionCount}</span>
              )}
              {uiState === "editing" && !isEditingDirectly && (
                <>
                  <button onClick={handleDirectEdit} className="edit-direct-button">
                    ✏️ Edit Content Directly
                  </button>
                  <button 
                    onClick={() => setShowFeedbackForm(!showFeedbackForm)} 
                    className="feedback-toggle-button"
                  >
                    💬 Give Instant Feedback
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Instant Feedback Form */}
          {showFeedbackForm && uiState === "editing" && (
            <div className="instant-feedback-form">
              <h4>Instant Feedback</h4>
              <textarea
                value={generalFeedback}
                onChange={(e) => setGeneralFeedback(e.target.value)}
                placeholder="Provide feedback to improve the content (e.g., 'Make it more technical', 'Add statistics', 'Simplify the language')"
                rows={3}
                className="feedback-textarea"
              />
              <div className="feedback-actions">
                <button onClick={handleInstantFeedback} className="apply-feedback-button">
                  Apply Feedback & Regenerate
                </button>
                <button onClick={() => setShowFeedbackForm(false)} className="cancel-feedback-button">
                  Cancel
                </button>
              </div>
            </div>
          )}
          
          {/* Direct Content Editing */}
          {isEditingDirectly && uiState === "editing" ? (
            <div className="direct-edit-section">
              <h4>Edit Content Directly</h4>
              <textarea
                ref={contentTextareaRef}
                value={editableContent}
                onChange={(e) => setEditableContent(e.target.value)}
                rows={15}
                className="content-edit-textarea"
                placeholder="Edit the content directly here..."
              />
              <div className="direct-edit-actions">
                <button onClick={handleSaveDirectEdit} className="save-direct-button">
                  Save Changes
                </button>
                <button onClick={handleCancelDirectEdit} className="cancel-direct-button">
                  Cancel
                </button>
              </div>
            </div>
          ) : uiState === "editing" && Object.keys(sentences).length > 0 ? (
            <div className="sentence-editor">
              <h4>Edit Individual Sentences</h4>
              <div className="sentences-list">
                {Object.entries(sentences).map(([sentenceId, sentenceText]) => (
                  <div key={sentenceId} className="sentence-item">
                    {editingSentence === sentenceId ? (
                      <div className="sentence-edit-form">
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          rows={2}
                          className="sentence-edit-input"
                        />
                        <div className="sentence-edit-actions">
                          <button onClick={handleSaveEdit} className="save-button">
                            Save
                          </button>
                          <button onClick={handleCancelEdit} className="cancel-button">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="sentence-display">
                        <div className="sentence-text">
                          <span className="sentence-number">{sentenceId.replace("sentence_", "")}</span>
                          <span className="sentence-content">{sentenceText}</span>
                        </div>
                        <div className="sentence-actions">
                          <button
                            onClick={() => handleEditSentence(sentenceId)}
                            className="edit-button"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleFeedbackSentence(sentenceId)}
                            className="feedback-button"
                          >
                            Request Improvement
                          </button>
                          {sentenceFeedback[sentenceId] && (
                            <span className="feedback-indicator" title={sentenceFeedback[sentenceId]}>
                              💬 Feedback
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              
              <div className="editing-actions">
                <button onClick={handleIncorporateEdits} className="incorporate-button">
                  Apply Edits & Regenerate
                </button>
                <button onClick={handleApprove} className="approve-button">
                  Approve & Finalize
                </button>
              </div>
            </div>
          ) : (
            <div className="content-display">
              <ReactMarkdown>{currentContent}</ReactMarkdown>
            </div>
          )}
        </div>
      )}

      {uiState === "finished" && (
        <div className="finished-section">
          <h3>✅ Content Finalized</h3>
          <div className="content-display">
            <ReactMarkdown>{currentContent}</ReactMarkdown>
          </div>
          <button onClick={handleReset} className="reset-button">
            Start New Content
          </button>
        </div>
      )}
    </div>
  );
};

export default EditableContentDemo;
