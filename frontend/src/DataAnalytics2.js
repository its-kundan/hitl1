import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import "./App.css";

const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

const DataAnalytics2 = () => {
  // Tab state
  const [activeTab, setActiveTab] = useState("hitl"); // "hitl", "report", "report-view", "report-edit", "report-final", "chatbot"
  
  // HITL Analysis state
  const [uiState, setUiState] = useState("idle");
  const [currentStage, setCurrentStage] = useState(null);
  const [query, setQuery] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePath, setFilePath] = useState(null);
  const [fileName, setFileName] = useState(null);
  
  // HITL workflow state
  const [threadId, setThreadId] = useState(null);
  const [plan, setPlan] = useState([]);
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [generatedSections, setGeneratedSections] = useState([]);
  const [currentSection, setCurrentSection] = useState(null);
  const [dataProfile, setDataProfile] = useState(null);
  const [finalOutput, setFinalOutput] = useState("");
  const [finalOutputOriginal, setFinalOutputOriginal] = useState("");
  
  // Feedback state
  const [generalFeedback, setGeneralFeedback] = useState("");
  const [editedContent, setEditedContent] = useState("");
  const [sentenceFeedbacks, setSentenceFeedbacks] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [comparisonView, setComparisonView] = useState(false);
  
  // Report Viewer state
  const [reportHtml, setReportHtml] = useState("");
  const [reportOriginalHtml, setReportOriginalHtml] = useState("");
  const [reportOriginalText, setReportOriginalText] = useState("");
  const [reportVisible, setReportVisible] = useState(false);
  const [reportViewMode, setReportViewMode] = useState("inline"); // "inline" or "text"
  const [reportEditMode, setReportEditMode] = useState(false);
  const [reportEditedText, setReportEditedText] = useState("");
  const [reportFinalText, setReportFinalText] = useState("");
  const [reportShowComparison, setReportShowComparison] = useState(false);
  const [reportGeneralFeedback, setReportGeneralFeedback] = useState("");
  const [reportSentenceFeedbacks, setReportSentenceFeedbacks] = useState([]);
  const [selectedText, setSelectedText] = useState("");
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [feedbackDialogText, setFeedbackDialogText] = useState("");
  const [feedbackType, setFeedbackType] = useState("Other");
  const [inlineEditableHtml, setInlineEditableHtml] = useState("");
  
  // Chatbot state
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatbotInitialized, setChatbotInitialized] = useState(false);
  
  const messagesEndRef = useRef(null);
  const eventSourceRef = useRef(null);
  const reportIframeRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [generatedSections, currentSection, finalOutput, chatHistory, reportHtml]);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // Listen for text selection from iframe
  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data && event.data.type === 'textSelected') {
        const text = event.data.text;
        if (text && text.length >= 1 && text.length <= 500) {
          setSelectedText(text);
          setShowFeedbackDialog(true);
        }
    };
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Text selection handler for direct DOM
  useEffect(() => {
    if (activeTab !== "report") return;

    const handleSelection = () => {
      const selection = window.getSelection();
      const selectedText = selection.toString().trim();
      
      if (selectedText && selectedText.length >= 1 && selectedText.length <= 500) {
        setSelectedText(selectedText);
        setShowFeedbackDialog(true);
      }
    };

    document.addEventListener('mouseup', handleSelection);
    return () => document.removeEventListener('mouseup', handleSelection);
  }, [activeTab]);

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
    setCurrentStage("data_profiling");
    setPlan([]);
    setGeneratedSections([]);
    setCurrentSection(null);
    setFinalOutput("");
    
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
        if (!event || !event.data) return;
        
        const data = JSON.parse(event.data);
        if (!data || typeof data !== 'object') return;
        
        // Debug logging
        console.log("SSE Event received:", data.type, data.data);
        
        if (data.type === 'status' && data.data) {
          const step = data.data.step;
          setCurrentStage(step);
          console.log("Status update - step:", step);
          
          // Handle various step names that might come from backend
          if (step === 'data_profiling_complete' || step === 'data_profiling' || step.includes('profiling')) {
            setUiState("planning");
          } else if (step === 'planning_complete' || step === 'planning' || step.includes('plan')) {
            setUiState("generating");
          } else if (step === 'section_generated' || step.includes('section')) {
            setUiState("review");
          } else if (step === 'awaiting_human_review') {
            setUiState("review");
          } else if (step === 'awaiting_final_report_review') {
            setUiState("final_review");
          } else if (step === 'finalized' || step === 'finished') {
            setUiState("finished");
          }
        } else if (data.type === 'data_profile' && data.data) {
          console.log("Data profile received");
          setDataProfile(data.data);
          setUiState("planning");
        } else if (data.type === 'plan' && data.data) {
          console.log("Plan received:", data.data);
          setPlan(Array.isArray(data.data) ? data.data : []);
          setUiState("generating");
        } else if (data.type === 'section' && data.data) {
          const section = data.data;
          const idx = (typeof section.current_index === 'number') ? section.current_index : currentSectionIndex;
          setCurrentSection(section);
          setCurrentSectionIndex(idx);
          
          // Update generated sections
          setGeneratedSections(prev => {
            if (!Array.isArray(prev)) return [section];
            const newSections = [...prev];
            while (newSections.length <= idx) {
              newSections.push(null);
            }
            newSections[idx] = section;
            return newSections;
          });
          
          setUiState("review");
        } else if (data.type === 'user_feedback' && data.data) {
          setUiState("review");
          if (data.data.plan) {
            setPlan(Array.isArray(data.data.plan) ? data.data.plan : []);
          }
          if (typeof data.data.current_index === 'number') {
            setCurrentSectionIndex(data.data.current_index);
          }
          if (Array.isArray(data.data.generated_sections)) {
            setGeneratedSections(data.data.generated_sections);
          }
          if (data.data.current_chunk) {
            setCurrentSection(data.data.current_chunk);
          }
        } else if (data.type === 'final_report_review' && data.data) {
          setFinalOutput(data.data.final_output || "");
          setFinalOutputOriginal(data.data.final_output_original || "");
          setUiState("final_review");
        } else if (data.type === 'final_report_regenerated' && data.data) {
          setFinalOutput(data.data.final_output || "");
          setUiState("final_review");
        } else if (data.type === 'finished' && data.data) {
          setFinalOutput(data.data.final_output || "");
          setUiState("finished");
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
          }
        } else if (data.type === 'error' && data.data) {
          const errorMsg = data.data.message || "An error occurred";
          alert("Error: " + errorMsg);
          setUiState("idle");
        }
      } catch (err) {
        // Only log non-extension errors
        if (err && err.message && !err.message.includes('content.js')) {
          console.error("Error parsing SSE data:", err);
        }
      }
    };
    
    eventSourceRef.current.onerror = (error) => {
      // Only log non-extension errors
      if (error && (!error.message || !error.message.includes('content.js'))) {
        console.error("SSE error:", error);
        console.error("EventSource readyState:", eventSourceRef.current?.readyState);
        console.error("EventSource URL:", eventSourceRef.current?.url);
      }
      // Check if connection closed
      if (eventSourceRef.current && eventSourceRef.current.readyState === EventSource.CLOSED) {
        console.warn("SSE connection closed. Attempting to reconnect...");
        // Don't set to idle immediately, might be temporary
        setTimeout(() => {
          if (eventSourceRef.current && eventSourceRef.current.readyState === EventSource.CLOSED) {
            setUiState("idle");
            alert("Connection lost. Please try again.");
          }
        }, 5000);
      } else if (eventSourceRef.current) {
        eventSourceRef.current.close();
        setUiState("idle");
      }
    };
    
    // Log when connection opens
    eventSourceRef.current.onopen = () => {
      console.log("SSE connection opened for thread:", threadId);
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
        // Clear feedback
        setGeneralFeedback("");
        setEditedContent("");
        setSentenceFeedbacks([]);
        startStreaming(threadId);
      }
    } catch (err) {
      alert("Failed to approve: " + err.message);
    }
  };

  const handleFeedback = async () => {
    if (!threadId) return;
    
    try {
      // Convert sentence feedbacks to API format
      const sentenceFeedbackApi = sentenceFeedbacks.map(sf => ({
        text: sf.selectedText || sf.text,
        feedback: sf.feedbackText || sf.feedback
      }));
      
      const response = await fetch(`${BASE_URL}/data-analytics2/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: threadId,
          review_action: "feedback",
          human_comment: generalFeedback || null,
          edited_content: editedContent || null,
          sentence_feedback: sentenceFeedbackApi.length > 0 ? sentenceFeedbackApi : null
        })
      });
      
      const data = await response.json();
      if (data.status === "resumed") {
        // Clear feedback
        setGeneralFeedback("");
        setEditedContent("");
        setSentenceFeedbacks([]);
        startStreaming(threadId);
      }
    } catch (err) {
      alert("Failed to submit feedback: " + err.message);
    }
  };

  const handleFinalReportApprove = async () => {
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
        setUiState("finished");
      }
    } catch (err) {
      alert("Failed to approve: " + err.message);
    }
  };

  const handleFinalReportFeedback = async () => {
    if (!threadId) return;
    
    try {
      const sentenceFeedbackApi = reportSentenceFeedbacks.map(sf => ({
        text: sf.selectedText || sf.text,
        feedback: sf.feedbackText || sf.feedback
      }));
      
      const response = await fetch(`${BASE_URL}/data-analytics2/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: threadId,
          review_action: "feedback",
          human_comment: reportGeneralFeedback || null,
          edited_content: reportEditedText || null,
          sentence_feedback: sentenceFeedbackApi.length > 0 ? sentenceFeedbackApi : null
        })
      });
      
      const data = await response.json();
      if (data.status === "resumed") {
        setReportGeneralFeedback("");
        setReportEditedText("");
        setReportSentenceFeedbacks([]);
        startStreaming(threadId);
      }
    } catch (err) {
      alert("Failed to submit feedback: " + err.message);
    }
  };

  const addSentenceFeedback = () => {
    if (!selectedText || !feedbackDialogText.trim()) return;
    
    const newFeedback = {
      id: Date.now(),
      selectedText: selectedText,
      feedbackText: feedbackDialogText,
      feedbackType: feedbackType,
      timestamp: new Date().toISOString()
    };
    
    if (activeTab === "report" || activeTab.startsWith("report-")) {
      setReportSentenceFeedbacks([...reportSentenceFeedbacks, newFeedback]);
    } else {
      setSentenceFeedbacks([...sentenceFeedbacks, newFeedback]);
    }
    
    setSelectedText("");
    setFeedbackDialogText("");
    setShowFeedbackDialog(false);
  };

  const removeSentenceFeedback = (id) => {
    if (activeTab === "report" || activeTab.startsWith("report-")) {
      setReportSentenceFeedbacks(reportSentenceFeedbacks.filter(fb => fb.id !== id));
    } else {
      setSentenceFeedbacks(sentenceFeedbacks.filter(fb => fb.id !== id));
    }
  };

  const initializeChatbot = async () => {
    if (chatbotInitialized) return;
    
    if (!threadId) {
      alert("Please start a HITL workflow first to generate charts and report for the chatbot.");
      return;
    }
    
    try {
      setChatLoading(true);
      // Initialize chatbot session with charts and report
      const response = await fetch(`${BASE_URL}/data-analytics2/chatbot/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: threadId
        })
      });
      
      if (response.ok) {
        setChatbotInitialized(true);
        setChatHistory([{
          role: "assistant",
          content: "I have loaded the charts and report. Ask me anything about the data analysis!"
        }]);
      } else {
        const errorData = await response.json();
        alert("Failed to initialize chatbot: " + (errorData.detail || "Unknown error"));
      }
    } catch (err) {
      console.error("Failed to initialize chatbot:", err);
      alert("Failed to initialize chatbot: " + err.message);
    } finally {
      setChatLoading(false);
    }
  };

  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !chatbotInitialized) return;
    
    const userMessage = chatInput.trim();
    setChatInput("");
    setChatHistory(prev => [...prev, { role: "user", content: userMessage }]);
    setChatLoading(true);
    
    try {
      const response = await fetch(`${BASE_URL}/data-analytics2/chatbot/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: threadId,
          message: userMessage
        })
      });
      
      const data = await response.json();
      setChatHistory(prev => [...prev, { role: "assistant", content: data.response }]);
    } catch (err) {
      setChatHistory(prev => [...prev, { role: "assistant", content: `Error: ${err.message}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  const loadReport = async () => {
    try {
      const url = threadId 
        ? `${BASE_URL}/data-analytics2/report?thread_id=${threadId}`
        : `${BASE_URL}/data-analytics2/report`;
      const response = await fetch(url, {
        method: "GET"
      });
      
      if (response.ok) {
        const html = await response.text();
        if (html && html !== "<html><body><h3>No report generated yet.</h3></body></html>") {
          setReportHtml(html);
          setReportOriginalHtml(html);
          setReportVisible(true);
          
          // Extract text for editing
          try {
            const textResponse = await fetch(`${BASE_URL}/data-analytics2/report/extract-text`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ html_content: html })
            });
            if (textResponse.ok) {
              const textData = await textResponse.json();
              setReportOriginalText(textData.text);
              setReportEditedText(textData.text);
            } else {
              // Fallback
              const textContent = html.replace(/<[^>]*>/g, '');
              setReportOriginalText(textContent);
              setReportEditedText(textContent);
            }
          } catch (e) {
            // Fallback
            const textContent = html.replace(/<[^>]*>/g, '');
            setReportOriginalText(textContent);
            setReportEditedText(textContent);
          }
          
          // Create inline editable version
          try {
            const inlineResponse = await fetch(`${BASE_URL}/data-analytics2/report/create-inline-editable`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ html_content: html })
            });
            if (inlineResponse.ok) {
              const inlineData = await inlineResponse.json();
              setInlineEditableHtml(inlineData.inline_html);
            }
          } catch (e) {
            console.error("Failed to create inline editable:", e);
          }
        }
      }
    } catch (err) {
      console.error("Failed to load report:", err);
    }
  };

  const regenerateReport = async () => {
    try {
      if (!reportOriginalText) {
        alert("No original report found. Please generate a report first.");
        return;
      }
      
      const hasFeedback = reportSentenceFeedbacks.length > 0 || reportGeneralFeedback || reportEditedText;
      if (!hasFeedback) {
        alert("No feedback or edits provided. Nothing to regenerate.");
        return;
      }
      
      const sentenceFeedbackApi = reportSentenceFeedbacks.map(sf => ({
        text: sf.selectedText || sf.text,
        feedback: sf.feedbackText || sf.feedback
      }));
      
      const response = await fetch(`${BASE_URL}/data-analytics2/report/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          general_feedback: reportGeneralFeedback,
          edited_text: reportEditedText,
          sentence_feedbacks: sentenceFeedbackApi
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to regenerate report");
      }
      
      const data = await response.json();
      if (data.final_report) {
        setReportFinalText(data.final_report);
        setReportHtml(data.final_report); // Update main report HTML
        // Also update inline editable version
        try {
          const inlineResponse = await fetch(`${BASE_URL}/data-analytics2/report/create-inline-editable`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ html_content: data.final_report })
          });
          if (inlineResponse.ok) {
            const inlineData = await inlineResponse.json();
            setInlineEditableHtml(inlineData.inline_html);
          }
        } catch (e) {
          console.error("Failed to create inline editable:", e);
        }
        // Switch to final report tab
        setActiveTab("report-final");
        alert("✅ Final report generated successfully with all feedbacks incorporated!");
      }
    } catch (err) {
      alert("Failed to regenerate report: " + err.message);
    }
  };

  const resetSession = () => {
    setUiState("idle");
    setQuery("");
    setSelectedFile(null);
    setFilePath(null);
    setFileName(null);
    setPlan([]);
    setGeneratedSections([]);
    setCurrentSection(null);
    setFinalOutput("");
    setGeneralFeedback("");
    setEditedContent("");
    setSentenceFeedbacks([]);
    setThreadId(null);
    setCurrentSectionIndex(0);
    setReportHtml("");
    setReportVisible(false);
    setChatHistory([]);
    setChatbotInitialized(false);
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
  };

  // Handle report tab initialization
  useEffect(() => {
    if ((activeTab === "report" || activeTab.startsWith("report-")) && !reportHtml && threadId) {
      loadReport();
    }
  }, [activeTab, threadId]);

  const renderReportViewer = () => {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2>📄 Interactive Analysis Report Viewer</h2>
          <button 
            onClick={() => { 
              setReportVisible(!reportVisible);
              if (!reportVisible && !reportHtml) loadReport();
            }} 
            className="btn-primary"
          >
            {reportVisible ? '❌ Hide Report' : '✅ Show Report'}
          </button>
        </div>

        {reportVisible && (
          <div>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
              <button
                onClick={() => setActiveTab("report-view")}
                className={activeTab === "report-view" ? "btn-primary" : "btn-secondary"}
                style={{ flex: 1 }}
              >
                📄 View Report
              </button>
              <button
                onClick={() => setActiveTab("report-edit")}
                className={activeTab === "report-edit" ? "btn-primary" : "btn-secondary"}
                style={{ flex: 1 }}
              >
                ✏️ Edit & Feedback
              </button>
              <button
                onClick={() => setActiveTab("report-final")}
                className={activeTab === "report-final" ? "btn-primary" : "btn-secondary"}
                style={{ flex: 1 }}
              >
                📊 Final Report
              </button>
            </div>

            {activeTab === "report-view" && (
              <div>
                {reportHtml ? (
                  <div>
                    {/* Add text selection detection script to HTML */}
                    <iframe
                      ref={reportIframeRef}
                      srcDoc={reportHtml.replace(
                        '<head>',
                        `<head>
                        <script>
                        (function() {
                          'use strict';
                          let selectionTimeout = null;
                          let justSelected = false;
                          
                          function handleTextSelection() {
                            if (justSelected) return;
                            if (selectionTimeout) clearTimeout(selectionTimeout);
                            
                            selectionTimeout = setTimeout(function() {
                              const selection = window.getSelection();
                              const selectedText = selection.toString().trim();
                              
                              if (selectedText && selectedText.length >= 1 && selectedText.length <= 500) {
                                if (selection.rangeCount > 0) {
                                  justSelected = true;
                                  try {
                                    sessionStorage.setItem('pendingTextSelection_view_report', JSON.stringify({
                                      text: selectedText,
                                      timestamp: Date.now()
                                    }));
                                    if (window.parent && window.parent !== window && window.parent.postMessage) {
                                      window.parent.postMessage({
                                        type: 'textSelected',
                                        text: selectedText,
                                        timestamp: Date.now()
                                      }, '*');
                                    }
                                  } catch (e) {
                                    console.error('Error storing selection:', e);
                                  }
                                  setTimeout(function() { justSelected = false; }, 500);
                                }
                              }
                            }, 150);
                          }
                          
                          document.addEventListener('mouseup', handleTextSelection);
                          document.addEventListener('keyup', function(e) {
                            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                              handleTextSelection();
                            }
                          });
                        })();
                        </script>`
                      )}
                      style={{ width: '100%', height: '900px', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                      title="Report Viewer"
                      sandbox="allow-scripts allow-same-origin"
                    />
                    <div style={{ marginTop: '1rem' }}>
                      <a 
                        href={`${BASE_URL}/data-analytics2/report/download`}
                        download="interactive_analysis_report.html"
                        className="btn-secondary"
                      >
                        ⬇️ Download Original Report
                      </a>
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                    <p>No report generated yet. Use the Controls to run analysis.</p>
                    <button onClick={loadReport} className="btn-primary" style={{ marginTop: '1rem' }}>
                      Load Report
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === "report-edit" && (
              <div>
                {reportOriginalHtml && reportOriginalText ? (
                  <>
                    <div style={{ marginBottom: '1rem' }}>
                      <h3>📝 Report Editing & Feedback</h3>
                      
                      {/* View Mode Toggle */}
                      <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>View Mode:</label>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            onClick={() => setReportViewMode("inline")}
                            className={reportViewMode === "inline" ? "btn-primary" : "btn-secondary"}
                            style={{ flex: 1 }}
                          >
                            📝 Inline Editable
                          </button>
                          <button
                            onClick={() => setReportViewMode("text")}
                            className={reportViewMode === "text" ? "btn-primary" : "btn-secondary"}
                            style={{ flex: 1 }}
                          >
                            📝 Text Editor
                          </button>
                        </div>
                        <p style={{ marginTop: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                          💡 <strong>Inline editing:</strong> Images and charts are locked inline. Only text content is editable. Select any text to add feedback.
                        </p>
                      </div>

                      {/* Display based on view mode */}
                      {reportViewMode === "inline" ? (
                        <div style={{ marginBottom: '1rem' }}>
                          <h4>📄 Report Content (Images Locked Inline)</h4>
                          {inlineEditableHtml ? (
                            <iframe
                              srcDoc={inlineEditableHtml}
                              style={{ width: '100%', height: '800px', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                              title="Inline Editable Report"
                              sandbox="allow-scripts allow-same-origin"
                            />
                          ) : reportHtml ? (
                            <iframe
                              srcDoc={reportHtml}
                              style={{ width: '100%', height: '800px', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                              title="Report Editor"
                              sandbox="allow-scripts allow-same-origin"
                            />
                          ) : (
                            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                              <p>No report available. Generate a report first.</p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{ marginBottom: '1rem' }}>
                          <h4>📝 Report Text Content (Editable)</h4>
                          <textarea
                            value={reportEditedText || reportOriginalText}
                            onChange={(e) => setReportEditedText(e.target.value)}
                            style={{ width: '100%', height: '600px', padding: '1rem', fontFamily: 'monospace', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                            placeholder="Edit ONLY the text content here. Visual elements (images/charts) are locked and cannot be edited."
                            onSelect={(e) => {
                              const selection = window.getSelection();
                              const selectedText = selection.toString().trim();
                              if (selectedText && selectedText.length >= 1 && selectedText.length <= 500) {
                                setSelectedText(selectedText);
                                setShowFeedbackDialog(true);
                              }
                            }}
                          />
                        </div>
                      )}
                    </div>

                <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--surface-color)', borderRadius: '4px' }}>
                  <h3>✏️ Report Editing & Feedback</h3>
                  
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>General Feedback:</label>
                    <textarea
                      value={reportGeneralFeedback}
                      onChange={(e) => setReportGeneralFeedback(e.target.value)}
                      placeholder="E.g., 'Make the executive summary more concise', 'Add more statistical details', etc."
                      style={{ width: '100%', height: '100px', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                    />
                  </div>

                  {showFeedbackDialog && (
                    <div style={{ 
                      position: 'fixed', 
                      top: '50%', 
                      left: '50%', 
                      transform: 'translate(-50%, -50%)',
                      background: 'var(--surface-color)',
                      padding: '1.5rem',
                      borderRadius: '8px',
                      boxShadow: 'var(--shadow-xl)',
                      zIndex: 1000,
                      minWidth: '400px',
                      border: '2px solid var(--primary-color)'
                    }}>
                      <h3 style={{ marginBottom: '1rem' }}>Add Feedback</h3>
                      <div style={{ marginBottom: '0.5rem', padding: '0.5rem', background: 'var(--background-color)', borderRadius: '4px' }}>
                        <strong>Selected Text:</strong> {selectedText.substring(0, 100)}{selectedText.length > 100 ? '...' : ''}
                      </div>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.25rem' }}>Feedback Type:</label>
                        <select
                          value={feedbackType}
                          onChange={(e) => setFeedbackType(e.target.value)}
                          style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                        >
                          <option value="Clarity">Clarity</option>
                          <option value="Accuracy">Accuracy</option>
                          <option value="Completeness">Completeness</option>
                          <option value="Formatting">Formatting</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.25rem' }}>Feedback:</label>
                        <textarea
                          value={feedbackDialogText}
                          onChange={(e) => setFeedbackDialogText(e.target.value)}
                          placeholder="E.g., Make this more concise, add more detail..."
                          style={{ width: '100%', height: '100px', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button onClick={() => { setShowFeedbackDialog(false); setSelectedText(""); setFeedbackDialogText(""); }} className="btn-secondary">
                          Cancel
                        </button>
                        <button onClick={addSentenceFeedback} className="btn-primary" disabled={!feedbackDialogText.trim()}>
                          Add Feedback
                        </button>
                      </div>
                    </div>
                  )}

                  {reportSentenceFeedbacks.length > 0 && (
                    <div style={{ marginBottom: '1rem' }}>
                      <h4>Added Feedbacks:</h4>
                      {reportSentenceFeedbacks.map((fb, idx) => (
                        <div key={fb.id} style={{ 
                          padding: '0.5rem', 
                          marginBottom: '0.5rem', 
                          background: 'var(--background-color)', 
                          borderRadius: '4px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}>
                          <div style={{ flex: 1 }}>
                            <strong>[{fb.feedbackType}]</strong> Text: "{fb.selectedText.substring(0, 50)}..." → Feedback: {fb.feedbackText}
                          </div>
                          <button onClick={() => removeSentenceFeedback(fb.id)} className="btn-secondary" style={{ marginLeft: '0.5rem' }}>
                            🗑️
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Feedback Summary */}
                  {(reportSentenceFeedbacks.length > 0 || reportGeneralFeedback) && (
                    <div style={{ marginBottom: '1rem', padding: '0.5rem', background: 'var(--background-color)', borderRadius: '4px' }}>
                      <h4>📊 Feedback Summary</h4>
                      {reportGeneralFeedback && (
                        <div style={{ marginBottom: '0.5rem' }}>
                          <strong>General Feedback:</strong>
                          <div style={{ padding: '0.5rem', background: 'var(--surface-color)', borderRadius: '4px', marginTop: '0.25rem' }}>
                            {reportGeneralFeedback}
                          </div>
                        </div>
                      )}
                      {reportSentenceFeedbacks.length > 0 && (
                        <div>
                          <strong>Sentence-Level Feedbacks:</strong> {reportSentenceFeedbacks.length} feedback(s)
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button 
                      onClick={async () => {
                        if (!reportOriginalText) {
                          alert("No original report found. Please generate a report first.");
                          return;
                        }
                        const hasFeedback = reportSentenceFeedbacks.length > 0 || reportGeneralFeedback || reportEditedText;
                        if (!hasFeedback) {
                          alert("No feedback or edits provided. Nothing to regenerate.");
                          return;
                        }
                        await regenerateReport();
                      }} 
                      className="btn-primary" 
                      style={{ flex: 2 }}
                      disabled={!reportGeneralFeedback && reportSentenceFeedbacks.length === 0 && !reportEditedText}
                    >
                      🚀 Regenerate with Feedback
                    </button>
                    <button 
                      onClick={() => { 
                        setReportGeneralFeedback(""); 
                        setReportEditedText(reportOriginalText || ""); 
                        setReportSentenceFeedbacks([]); 
                      }} 
                      className="btn-secondary"
                      style={{ flex: 1 }}
                    >
                      🔄 Clear All
                    </button>
                  </div>
                </div>
                  </>
                ) : (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                    <p>No report available. Generate a report first.</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === "report-final" && (
              <div>
                {reportFinalText ? (
                  <div>
                    <h3>🎉 Final Generated Report</h3>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                      This is the final version generated after incorporating all your edits and feedback.
                    </p>
                    
                    {/* Comparison View */}
                    {reportShowComparison && reportOriginalHtml && (
                      <div style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--background-color)', borderRadius: '4px' }}>
                        <h4>📊 Final vs Original Comparison</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                          <div>
                            <h5>Original Version</h5>
                            <div style={{ border: '1px solid var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
                              <iframe
                                srcDoc={reportOriginalHtml}
                                style={{ width: '100%', height: '400px', border: 'none' }}
                                title="Original Report"
                                sandbox="allow-scripts allow-same-origin"
                              />
                            </div>
                          </div>
                          <div>
                            <h5>Final Version</h5>
                            <div style={{ border: '1px solid var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
                              <iframe
                                srcDoc={reportFinalText}
                                style={{ width: '100%', height: '400px', border: 'none' }}
                                title="Final Report"
                                sandbox="allow-scripts allow-same-origin"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Final Report Display */}
                    <div style={{ marginBottom: '1rem', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '1rem', background: 'var(--surface-color)' }}>
                      <iframe
                        srcDoc={reportFinalText}
                        style={{ width: '100%', height: '900px', border: 'none', borderRadius: '4px' }}
                        title="Final Report"
                        sandbox="allow-scripts allow-same-origin"
                      />
                    </div>
                    
                    {/* Action Buttons */}
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <a 
                        href={`data:text/html;charset=utf-8,${encodeURIComponent(reportFinalText)}`}
                        download="final_analysis_report.html"
                        className="btn-primary"
                      >
                        📥 Download as HTML
                      </a>
                      <a 
                        href={`data:text/markdown;charset=utf-8,${encodeURIComponent(reportFinalText.replace(/<[^>]*>/g, ''))}`}
                        download="final_analysis_report.md"
                        className="btn-secondary"
                      >
                        📄 Download as Markdown
                      </a>
                      <button
                        onClick={() => setReportShowComparison(!reportShowComparison)}
                        className="btn-secondary"
                      >
                        🔄 {reportShowComparison ? 'Hide' : 'Show'} Comparison
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                    <p>Go to 'Edit & Feedback' tab to make edits and provide feedback, then click '🚀 Regenerate with Feedback' to create the final version.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderChatbot = () => {
    return (
      <div style={{ padding: '1rem', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <h2>💬 Insight Chatbot</h2>
        
        {!chatbotInitialized && (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <button onClick={initializeChatbot} className="btn-primary" disabled={chatLoading}>
              {chatLoading ? "Initializing..." : "Initialize Chatbot"}
            </button>
          </div>
        )}

        {chatbotInitialized && (
          <>
            <div style={{ flex: 1, overflowY: 'auto', marginBottom: '1rem', padding: '1rem', background: 'var(--surface-color)', borderRadius: '4px' }}>
              {chatHistory.map((msg, idx) => (
                <div key={idx} style={{ marginBottom: '1rem' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '0.25rem', color: msg.role === 'user' ? 'var(--primary-color)' : 'var(--text-secondary)' }}>
                    {msg.role === 'user' ? 'You' : 'Assistant'}
                  </div>
                  <div style={{ padding: '0.75rem', background: msg.role === 'user' ? 'var(--primary-light)' : 'var(--background-color)', borderRadius: '4px' }}>
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div style={{ padding: '0.75rem', color: 'var(--text-secondary)' }}>
                  <div className="spinner" style={{ display: 'inline-block', marginRight: '0.5rem' }} />
                  Thinking...
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleChatSubmit} style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask a question about the charts..."
                className="chat-input"
                style={{ flex: 1 }}
                disabled={chatLoading}
              />
              <button type="submit" className="btn-primary" disabled={chatLoading || !chatInput.trim()}>
                Send
              </button>
            </form>
          </>
        )}
      </div>
    );
  };

  const renderHITLAnalysis = () => {
    return (
      <div style={{ padding: '1rem' }}>
        <h2>🔄 Human-In-The-Loop Analysis Workflow</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Iterative, step-by-step data analysis with human review and refinement
        </p>

        {!threadId && (
          <div style={{ padding: '1rem', background: 'var(--surface-color)', borderRadius: '4px', marginBottom: '1rem' }}>
            <h3>🚀 Start New Analysis</h3>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem' }}>Analysis Request:</label>
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="E.g., 'Analyze sales trends and identify key drivers of profitability'"
                style={{ width: '100%', height: '100px', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem' }}>Upload Dataset (CSV):</label>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                style={{ width: '100%', padding: '0.5rem' }}
              />
              {fileName && <p style={{ marginTop: '0.5rem', color: 'var(--text-secondary)' }}>Selected: {fileName}</p>}
            </div>
            <button 
              onClick={handleStart} 
              className="btn-primary" 
              disabled={!query.trim() || !filePath}
            >
              ▶️ Start HITL Workflow
            </button>
          </div>
        )}

        {threadId && (
          <>
            {/* Plan Sidebar - Editable */}
            {plan.length > 0 && (
              <div style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--surface-color)', borderRadius: '4px', border: '2px solid var(--primary-color)' }}>
                <h3>📋 Analysis Plan (Editable)</h3>
                <div style={{ marginBottom: '1rem' }}>
                  {plan.map((item, idx) => (
                    <div key={idx} style={{ 
                      display: 'flex', 
                      gap: '0.5rem', 
                      marginBottom: '0.5rem',
                      padding: '0.5rem',
                      background: idx === currentSectionIndex ? 'var(--primary-light)' : 'var(--background-color)',
                      borderRadius: '4px',
                      alignItems: 'center'
                    }}>
                      <input
                        type="text"
                        value={item}
                        onChange={(e) => {
                          const newPlan = [...plan];
                          newPlan[idx] = e.target.value;
                          setPlan(newPlan);
                        }}
                        style={{ 
                          flex: 1, 
                          padding: '0.5rem', 
                          border: '1px solid var(--border-color)', 
                          borderRadius: '4px',
                          background: 'var(--surface-color)'
                        }}
                      />
                      <button
                        onClick={() => {
                          const newPlan = plan.filter((_, i) => i !== idx);
                          setPlan(newPlan);
                          if (currentSectionIndex >= newPlan.length) {
                            setCurrentSectionIndex(Math.max(0, newPlan.length - 1));
                          }
                        }}
                        className="btn-secondary"
                        style={{ padding: '0.25rem 0.5rem' }}
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <button
                    onClick={() => {
                      const newPlan = [...plan];
                      const currentIdx = currentSectionIndex;
                      if (currentIdx > 0) {
                        [newPlan[currentIdx], newPlan[currentIdx - 1]] = [newPlan[currentIdx - 1], newPlan[currentIdx]];
                        setPlan(newPlan);
                        setCurrentSectionIndex(currentIdx - 1);
                      }
                    }}
                    className="btn-secondary"
                    disabled={currentSectionIndex === 0}
                    style={{ flex: 1 }}
                  >
                    ⬆️ Move Up
                  </button>
                  <button
                    onClick={() => {
                      const newPlan = [...plan];
                      const currentIdx = currentSectionIndex;
                      if (currentIdx < newPlan.length - 1) {
                        [newPlan[currentIdx], newPlan[currentIdx + 1]] = [newPlan[currentIdx + 1], newPlan[currentIdx]];
                        setPlan(newPlan);
                        setCurrentSectionIndex(currentIdx + 1);
                      }
                    }}
                    className="btn-secondary"
                    disabled={currentSectionIndex >= plan.length - 1}
                    style={{ flex: 1 }}
                  >
                    ⬇️ Move Down
                  </button>
                </div>
                <button
                  onClick={() => {
                    setPlan([...plan, "New Analysis Step"]);
                  }}
                  className="btn-secondary"
                  style={{ width: '100%', marginBottom: '0.5rem' }}
                >
                  ➕ Add Step
                </button>
                <button
                  onClick={async () => {
                    if (threadId) {
                      try {
                        const response = await fetch(`${BASE_URL}/data-analytics2/resume`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            thread_id: threadId,
                            review_action: "approved",
                            updated_plan: plan
                          })
                        });
                        if (response.ok) {
                          alert("Plan updated successfully!");
                        }
                      } catch (err) {
                        alert("Failed to update plan: " + err.message);
                      }
                    }
                  }}
                  className="btn-primary"
                  style={{ width: '100%' }}
                >
                  💾 Save Plan Changes
                </button>
              </div>
            )}

            {/* Progress Indicator */}
            {plan.length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span>Section {currentSectionIndex + 1} of {plan.length}</span>
                  <span>{Math.round(((currentSectionIndex + 1) / plan.length) * 100)}%</span>
                </div>
                <div style={{ width: '100%', height: '8px', background: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div 
                    style={{ 
                      width: `${((currentSectionIndex + 1) / plan.length) * 100}%`, 
                      height: '100%', 
                      background: 'var(--primary-color)',
                      transition: 'width 0.3s'
                    }} 
                  />
                </div>
              </div>
            )}

            {/* Completed Sections */}
            {generatedSections.filter((s, idx) => s && idx < currentSectionIndex).length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <h3>✅ Completed Sections</h3>
                {generatedSections.map((section, idx) => {
                  if (!section || idx >= currentSectionIndex) return null;
                  return (
                    <details key={idx} style={{ marginBottom: '0.5rem', padding: '0.5rem', background: 'var(--background-color)', borderRadius: '4px' }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>
                        Section {idx + 1}: {section.section_title || 'Untitled'}
                      </summary>
                      <div style={{ marginTop: '0.5rem', padding: '0.5rem' }}>
                        <ReactMarkdown>{section.content || ''}</ReactMarkdown>
                        {section.visualizations && section.visualizations.length > 0 && (
                          <div style={{ marginTop: '0.5rem' }}>
                            <h4>📊 Visualizations</h4>
                            {section.visualizations.map((viz, vIdx) => (
                              <div key={vIdx} style={{ marginBottom: '1rem', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem' }}>
                                {viz.html_path && (
                                  <div>
                                    <div style={{ marginBottom: '0.25rem', fontWeight: 'bold' }}>{viz.title || `Visualization ${vIdx + 1}`}</div>
                                    <iframe
                                      src={`${BASE_URL}/${viz.html_path}`}
                                      style={{ width: '100%', height: '500px', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                                      title={viz.title || `Visualization ${vIdx + 1}`}
                                      sandbox="allow-scripts allow-same-origin"
                                    />
                                  </div>
                                )}
                                {viz.png_path && !viz.html_path && (
                                  <div>
                                    <div style={{ marginBottom: '0.25rem', fontWeight: 'bold' }}>{viz.title || `Visualization ${vIdx + 1}`}</div>
                                    <img 
                                      src={`${BASE_URL}/${viz.png_path}`} 
                                      alt={viz.title || `Visualization ${vIdx + 1}`}
                                      style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px' }}
                                    />
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {section.analysis_results && section.analysis_results !== {} && (
                          <div style={{ marginTop: '0.5rem' }}>
                            <h4>📈 Analysis Results</h4>
                            <pre style={{ background: 'var(--background-color)', padding: '0.5rem', borderRadius: '4px', overflow: 'auto', maxHeight: '300px' }}>
                              {JSON.stringify(section.analysis_results, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
            )}

            {/* Current Section */}
            {currentSection && uiState === "review" && (
              <div style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--surface-color)', borderRadius: '4px', border: '2px solid var(--primary-color)' }}>
                <h3>📝 Current Section (Under Review)</h3>
                
                {comparisonView && (
                  <div style={{ marginBottom: '1rem', padding: '0.5rem', background: 'var(--background-color)', borderRadius: '4px' }}>
                    <p style={{ margin: 0, color: 'var(--text-secondary)' }}>📊 Comparison View: Original vs Current</p>
                  </div>
                )}
                
                <div className="selectable-content">
                  <ReactMarkdown>{currentSection.content || ''}</ReactMarkdown>
                </div>
                
                {currentSection.visualizations && currentSection.visualizations.length > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    <h4>📊 Visualizations</h4>
                    {currentSection.visualizations.map((viz, idx) => (
                      <div key={idx} style={{ marginBottom: '1rem', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem' }}>
                        {viz.html_path && (
                          <div>
                            {viz.title && <div style={{ marginBottom: '0.25rem', fontWeight: 'bold' }}>{viz.title}</div>}
                            <iframe
                              src={`${BASE_URL}/${viz.html_path}`}
                              style={{ width: '100%', height: '500px', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                              title={viz.title || `Visualization ${idx + 1}`}
                              sandbox="allow-scripts allow-same-origin"
                            />
                          </div>
                        )}
                        {viz.png_path && !viz.html_path && (
                          <div>
                            {viz.title && <div style={{ marginBottom: '0.25rem', fontWeight: 'bold' }}>{viz.title}</div>}
                            <img 
                              src={`${BASE_URL}/${viz.png_path}`} 
                              alt={viz.title || `Visualization ${idx + 1}`}
                              style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px' }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                
                {currentSection.analysis_results && Object.keys(currentSection.analysis_results).length > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    <h4>📈 Analysis Results</h4>
                    <div style={{ background: 'var(--background-color)', padding: '0.5rem', borderRadius: '4px', overflow: 'auto', maxHeight: '300px' }}>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                        {JSON.stringify(currentSection.analysis_results, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}

                <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--background-color)', borderRadius: '4px' }}>
                  <h4>✏️ Review & Feedback</h4>
                  
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                    <button onClick={handleApprove} className="btn-primary" style={{ flex: 1 }}>
                      ✅ Approve & Continue
                    </button>
                    <button onClick={() => setEditMode(!editMode)} className="btn-secondary" style={{ flex: 1 }}>
                      ✏️ Edit Mode
                    </button>
                    <button onClick={() => setComparisonView(!comparisonView)} className="btn-secondary" style={{ flex: 1 }}>
                      🔄 Compare Versions
                    </button>
                  </div>

                  {editMode && (
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', marginBottom: '0.5rem' }}>Edit section content:</label>
                      <textarea
                        value={editedContent || currentSection.content || ''}
                        onChange={(e) => setEditedContent(e.target.value)}
                        style={{ width: '100%', height: '300px', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                      />
                    </div>
                  )}

                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>General Feedback:</label>
                    <textarea
                      value={generalFeedback}
                      onChange={(e) => setGeneralFeedback(e.target.value)}
                      placeholder="E.g., 'Make the insights more specific', 'Add more statistical details', etc."
                      style={{ width: '100%', height: '100px', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                    />
                  </div>

                  {showFeedbackDialog && (
                    <div style={{ 
                      position: 'fixed', 
                      top: '50%', 
                      left: '50%', 
                      transform: 'translate(-50%, -50%)',
                      background: 'var(--surface-color)',
                      padding: '1.5rem',
                      borderRadius: '8px',
                      boxShadow: 'var(--shadow-xl)',
                      zIndex: 1000,
                      minWidth: '400px',
                      border: '2px solid var(--primary-color)'
                    }}>
                      <h3 style={{ marginBottom: '1rem' }}>Add Feedback</h3>
                      <div style={{ marginBottom: '0.5rem', padding: '0.5rem', background: 'var(--background-color)', borderRadius: '4px' }}>
                        <strong>Selected Text:</strong> {selectedText.substring(0, 100)}{selectedText.length > 100 ? '...' : ''}
                      </div>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.25rem' }}>Feedback Type:</label>
                        <select
                          value={feedbackType}
                          onChange={(e) => setFeedbackType(e.target.value)}
                          style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                        >
                          <option value="Clarity">Clarity</option>
                          <option value="Accuracy">Accuracy</option>
                          <option value="Completeness">Completeness</option>
                          <option value="Formatting">Formatting</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.25rem' }}>Feedback:</label>
                        <textarea
                          value={feedbackDialogText}
                          onChange={(e) => setFeedbackDialogText(e.target.value)}
                          placeholder="E.g., Make this more concise, add more detail..."
                          style={{ width: '100%', height: '100px', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button onClick={() => { setShowFeedbackDialog(false); setSelectedText(""); setFeedbackDialogText(""); }} className="btn-secondary">
                          Cancel
                        </button>
                        <button onClick={addSentenceFeedback} className="btn-primary" disabled={!feedbackDialogText.trim()}>
                          Add Feedback
                        </button>
                      </div>
                    </div>
                  )}

                  {sentenceFeedbacks.length > 0 && (
                    <div style={{ marginBottom: '1rem' }}>
                      <h4>Added Feedbacks:</h4>
                      {sentenceFeedbacks.map((fb, idx) => (
                        <div key={fb.id} style={{ 
                          padding: '0.5rem', 
                          marginBottom: '0.5rem', 
                          background: 'var(--background-color)', 
                          borderRadius: '4px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}>
                          <div style={{ flex: 1 }}>
                            <strong>[{fb.feedbackType}]</strong> Text: "{fb.selectedText.substring(0, 50)}..." → Feedback: {fb.feedbackText}
                          </div>
                          <button onClick={() => removeSentenceFeedback(fb.id)} className="btn-secondary" style={{ marginLeft: '0.5rem' }}>
                            🗑️
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <button 
                    onClick={handleFeedback} 
                    className="btn-primary" 
                    style={{ width: '100%' }}
                    disabled={!generalFeedback && sentenceFeedbacks.length === 0 && !editedContent}
                  >
                    📤 Submit Feedback & Regenerate
                  </button>
                </div>
              </div>
            )}

            {/* Final Report Review */}
            {uiState === "final_review" && finalOutput && (
              <div style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--surface-color)', borderRadius: '4px', border: '2px solid var(--primary-color)' }}>
                <h3>🎉 Final Report</h3>
                
                {editMode ? (
                  <textarea
                    value={reportEditedText || finalOutput}
                    onChange={(e) => setReportEditedText(e.target.value)}
                    style={{ width: '100%', height: '600px', padding: '0.5rem', fontFamily: 'monospace', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                  />
                ) : (
                  <div style={{ padding: '1rem', background: 'var(--background-color)', borderRadius: '4px' }}>
                    <ReactMarkdown>{finalOutput}</ReactMarkdown>
                  </div>
                )}

                <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--background-color)', borderRadius: '4px' }}>
                  <h4>✏️ Final Report Review & Feedback</h4>
                  
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                    <button onClick={handleFinalReportApprove} className="btn-primary" style={{ flex: 1 }}>
                      ✅ Approve Final Report
                    </button>
                    <button onClick={() => setEditMode(!editMode)} className="btn-secondary" style={{ flex: 1 }}>
                      ✏️ Toggle Edit Mode
                    </button>
                    <button onClick={() => setComparisonView(!comparisonView)} className="btn-secondary" style={{ flex: 1 }}>
                      🔄 Compare Versions
                    </button>
                  </div>

                  {comparisonView && finalOutputOriginal && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                      <div>
                        <h4>Original Version</h4>
                        <div style={{ padding: '0.5rem', background: 'var(--surface-color)', borderRadius: '4px', maxHeight: '400px', overflow: 'auto' }}>
                          <ReactMarkdown>{finalOutputOriginal}</ReactMarkdown>
                        </div>
                      </div>
                      <div>
                        <h4>Current Version</h4>
                        <div style={{ padding: '0.5rem', background: 'var(--surface-color)', borderRadius: '4px', maxHeight: '400px', overflow: 'auto' }}>
                          <ReactMarkdown>{finalOutput}</ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>General Feedback:</label>
                    <textarea
                      value={reportGeneralFeedback}
                      onChange={(e) => setReportGeneralFeedback(e.target.value)}
                      placeholder="E.g., 'Make the executive summary more concise', 'Add more statistical details', etc."
                      style={{ width: '100%', height: '100px', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                    />
                  </div>

                  {showFeedbackDialog && (
                    <div style={{ 
                      position: 'fixed', 
                      top: '50%', 
                      left: '50%', 
                      transform: 'translate(-50%, -50%)',
                      background: 'var(--surface-color)',
                      padding: '1.5rem',
                      borderRadius: '8px',
                      boxShadow: 'var(--shadow-xl)',
                      zIndex: 1000,
                      minWidth: '400px',
                      border: '2px solid var(--primary-color)'
                    }}>
                      <h3 style={{ marginBottom: '1rem' }}>Add Feedback</h3>
                      <div style={{ marginBottom: '0.5rem', padding: '0.5rem', background: 'var(--background-color)', borderRadius: '4px' }}>
                        <strong>Selected Text:</strong> {selectedText.substring(0, 100)}{selectedText.length > 100 ? '...' : ''}
                      </div>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.25rem' }}>Feedback Type:</label>
                        <select
                          value={feedbackType}
                          onChange={(e) => setFeedbackType(e.target.value)}
                          style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                        >
                          <option value="Clarity">Clarity</option>
                          <option value="Accuracy">Accuracy</option>
                          <option value="Completeness">Completeness</option>
                          <option value="Formatting">Formatting</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.25rem' }}>Feedback:</label>
                        <textarea
                          value={feedbackDialogText}
                          onChange={(e) => setFeedbackDialogText(e.target.value)}
                          placeholder="E.g., Make this more concise, add more detail..."
                          style={{ width: '100%', height: '100px', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button onClick={() => { setShowFeedbackDialog(false); setSelectedText(""); setFeedbackDialogText(""); }} className="btn-secondary">
                          Cancel
                        </button>
                        <button onClick={addSentenceFeedback} className="btn-primary" disabled={!feedbackDialogText.trim()}>
                          Add Feedback
                        </button>
                      </div>
                    </div>
                  )}

                  {reportSentenceFeedbacks.length > 0 && (
                    <div style={{ marginBottom: '1rem' }}>
                      <h4>Added Feedbacks:</h4>
                      {reportSentenceFeedbacks.map((fb, idx) => (
                        <div key={fb.id} style={{ 
                          padding: '0.5rem', 
                          marginBottom: '0.5rem', 
                          background: 'var(--background-color)', 
                          borderRadius: '4px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}>
                          <div style={{ flex: 1 }}>
                            <strong>[{fb.feedbackType}]</strong> Text: "{fb.selectedText.substring(0, 50)}..." → Feedback: {fb.feedbackText}
                          </div>
                          <button onClick={() => removeSentenceFeedback(fb.id)} className="btn-secondary" style={{ marginLeft: '0.5rem' }}>
                            🗑️
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <button 
                    onClick={handleFinalReportFeedback} 
                    className="btn-primary" 
                    style={{ width: '100%' }}
                    disabled={!reportGeneralFeedback && reportSentenceFeedbacks.length === 0 && !reportEditedText}
                  >
                    📤 Submit Feedback & Regenerate Report
                  </button>
                </div>

                <div style={{ marginTop: '1rem' }}>
                  <a 
                    href={`data:text/markdown;charset=utf-8,${encodeURIComponent(finalOutput)}`}
                    download="analysis_report.md"
                    className="btn-secondary"
                  >
                    📥 Download Report
                  </a>
                </div>
              </div>
            )}

            {/* Loading States */}
            {(uiState === "exploring" || uiState === "planning" || uiState === "generating") && (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                <div className="spinner" />
                <p>Processing: {currentStage || uiState}...</p>
                {threadId && (
                  <p style={{ fontSize: '0.9rem', marginTop: '0.5rem', opacity: 0.7 }}>
                    Thread ID: {threadId.substring(0, 8)}...
                    {eventSourceRef.current && eventSourceRef.current.readyState === EventSource.OPEN && (
                      <span style={{ color: 'green', marginLeft: '0.5rem' }}>● Connected</span>
                    )}
                    {eventSourceRef.current && eventSourceRef.current.readyState === EventSource.CONNECTING && (
                      <span style={{ color: 'orange', marginLeft: '0.5rem' }}>● Connecting...</span>
                    )}
                    {eventSourceRef.current && eventSourceRef.current.readyState === EventSource.CLOSED && (
                      <span style={{ color: 'red', marginLeft: '0.5rem' }}>● Disconnected</span>
                    )}
                  </p>
                )}
                {plan.length > 0 && (
                  <div style={{ marginTop: '1rem', textAlign: 'left', maxWidth: '600px', margin: '1rem auto' }}>
                    <p><strong>Analysis Plan ({plan.length} sections):</strong></p>
                    <ul style={{ textAlign: 'left' }}>
                      {plan.slice(0, 5).map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                      {plan.length > 5 && <li>... and {plan.length - 5} more</li>}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Refresh State Button */}
            {threadId && (
              <div style={{ marginTop: '1rem' }}>
                <button 
                  onClick={async () => {
                    try {
                      const response = await fetch(`${BASE_URL}/data-analytics2/state/${threadId}`);
                      const data = await response.json();
                      if (data.state) {
                        setPlan(data.state.plan || []);
                        setGeneratedSections(data.state.generated_sections || []);
                        setCurrentSectionIndex(data.state.current_section_index || 0);
                        setDataProfile(data.state.data_profile);
                        setFinalOutput(data.state.final_output || "");
                        setFinalOutputOriginal(data.state.final_output_original || "");
                        
                        const sections = data.state.generated_sections || [];
                        const currentIdx = data.state.current_section_index || 0;
                        if (sections && currentIdx < sections.length) {
                          setCurrentSection(sections[currentIdx]);
                        }
                      }
                    } catch (err) {
                      alert("Failed to refresh state: " + err.message);
                    }
                  }}
                  className="btn-secondary"
                >
                  🔄 Refresh State
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
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

        {/* Tab Navigation */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
          <button
            onClick={() => setActiveTab("hitl")}
            className={activeTab === "hitl" ? "btn-primary" : "btn-secondary"}
            style={{ flex: 1 }}
          >
            🔄 HITL Analysis
          </button>
          <button
            onClick={() => { 
              if (activeTab !== "report" && !activeTab.startsWith("report-")) {
                setActiveTab("report-view");
                setReportVisible(true);
                if (!reportHtml && threadId) loadReport();
              }
            }}
            className={activeTab === "report" || activeTab.startsWith("report-") ? "btn-primary" : "btn-secondary"}
            style={{ flex: 1 }}
          >
            📊 Report Viewer
          </button>
          <button
            onClick={() => { 
              setActiveTab("chatbot"); 
              if (!chatbotInitialized && threadId) initializeChatbot(); 
            }}
            className={activeTab === "chatbot" ? "btn-primary" : "btn-secondary"}
            style={{ flex: 1 }}
          >
            💬 Insight Chatbot
          </button>
        </div>

        {/* Tab Content */}
        <div className="messages-area" style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
          {activeTab === "hitl" && renderHITLAnalysis()}
          {(activeTab === "report" || activeTab.startsWith("report-")) && renderReportViewer()}
          {activeTab === "chatbot" && renderChatbot()}
        </div>
      </div>
    </div>
  );
};

export default DataAnalytics2;
