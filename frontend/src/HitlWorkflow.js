import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import './HitlWorkflow.css';

const HitlWorkflow = () => {
    const [query, setQuery] = useState('');
    const [threadId, setThreadId] = useState(null);
    const [status, setStatus] = useState('idle'); // idle, running, review, finished, error

    // State for the iterative flow
    const [plan, setPlan] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [completedSections, setCompletedSections] = useState([]);
    const [currentChunkContent, setCurrentChunkContent] = useState('');
    
    // Document comparison: Store first generated versions
    const [firstGeneratedVersions, setFirstGeneratedVersions] = useState([]);
    const [modifiedVersions, setModifiedVersions] = useState([]); // Store modified versions after edits/feedback
    const [showComparison, setShowComparison] = useState(false);
    
    // Sentence-level feedback (support multiple feedbacks)
    const [selectedText, setSelectedText] = useState('');
    const [selectionPosition, setSelectionPosition] = useState({ x: 0, y: 0 });
    const [showSentenceFeedback, setShowSentenceFeedback] = useState(false);
    const [sentenceFeedback, setSentenceFeedback] = useState('');
    const [allSentenceFeedbacks, setAllSentenceFeedbacks] = useState([]); // Array of {text, feedback}

    // Edit & Feedback State
    const [editMode, setEditMode] = useState(false);
    const [editedContent, setEditedContent] = useState('');
    const [feedback, setFeedback] = useState('');
    
    // Edit state for completed sections
    const [editingSectionIndex, setEditingSectionIndex] = useState(null);
    const [editedSectionContent, setEditedSectionContent] = useState('');

    // Plan editing state
    const [editingPlanIndex, setEditingPlanIndex] = useState(null);
    const [editingPlanValue, setEditingPlanValue] = useState('');

    const eventSourceRef = useRef(null);

    const startWorkflow = async () => {
        try {
            setStatus('running');
            setPlan([]);
            setCompletedSections([]);
            setCurrentChunkContent('');
            setCurrentIndex(0);
            setFirstGeneratedVersions([]);
            setModifiedVersions([]);

            const response = await fetch('http://localhost:8000/custom/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ human_request: query }),
            });

            const data = await response.json();
            setThreadId(data.thread_id);
            connectToStream(data.thread_id);

        } catch (error) {
            console.error('Error starting workflow:', error);
            setStatus('error');
        }
    };

    const submitReview = async (action) => {
        // action: "approved" or "feedback"
        try {
            setStatus('running'); // Back to running/generating

            // Combine all sentence feedbacks (including current one if not yet saved)
            let allFeedbacks = [...allSentenceFeedbacks];
            if (selectedText && sentenceFeedback && sentenceFeedback.trim()) {
                // Check if this feedback is already in the list
                const isDuplicate = allFeedbacks.some(fb => 
                    fb.text === selectedText && fb.feedback === sentenceFeedback.trim()
                );
                if (!isDuplicate) {
                    allFeedbacks.push({
                        text: selectedText,
                        feedback: sentenceFeedback.trim()
                    });
                }
            }
            
            // Determine if we need to regenerate (has edits, feedback, or sentence feedback)
            const hasEdits = editMode && editedContent && editedContent !== currentChunkContent;
            const hasFeedback = feedback && feedback.trim();
            const hasSentenceFeedback = allFeedbacks.length > 0;
            
            // Combine all feedback into human_comment
            let combinedFeedback = '';
            if (hasFeedback) {
                combinedFeedback = feedback.trim();
            }
            if (hasSentenceFeedback) {
                const sentenceFeedbacksText = allFeedbacks.map((fb, idx) => 
                    `Feedback ${idx + 1}: Please improve this specific sentence: "${fb.text}"\nFeedback: ${fb.feedback}`
                ).join('\n\n');
                
                const sentenceFb = `IMPORTANT - Multiple Sentence Feedbacks:\n${sentenceFeedbacksText}\n\nMake sure to incorporate ALL of these feedbacks into the revised version.`;
                if (combinedFeedback) {
                    combinedFeedback = `${combinedFeedback}\n\n${sentenceFb}`;
                } else {
                    combinedFeedback = sentenceFb;
                }
            }
            
            // Send all sentence feedbacks as array
            const sentenceFeedbackData = hasSentenceFeedback ? allFeedbacks : null;
            
            // If we have edits, feedback, or sentence feedback, use 'feedback' action to regenerate
            if ((hasEdits || hasFeedback || hasSentenceFeedback) && action === 'approved') {
                action = 'feedback';
            }
            
            // Always send edited content if it exists and is different
            const contentToSend = (hasEdits && editedContent) ? editedContent : null;

            const payload = {
                thread_id: threadId,
                review_action: action,
                human_comment: combinedFeedback || null,
                edited_content: contentToSend,
                updated_plan: plan, // Send updated plan to preserve new sections
                sentence_feedback: sentenceFeedbackData
            };
            
            // Store modified version before regenerating
            if (hasEdits || hasSentenceFeedback || hasFeedback) {
                const modifiedVersionsList = [...modifiedVersions];
                modifiedVersionsList[currentIndex] = editedContent || currentChunkContent;
                setModifiedVersions(modifiedVersionsList);
            }

            await fetch('http://localhost:8000/custom/resume', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            // Reset local review state (but keep allSentenceFeedbacks for display)
            setFeedback('');
            setEditMode(false);
            setSelectedText('');
            setSentenceFeedback('');
            setShowSentenceFeedback(false);
            // Don't clear allSentenceFeedbacks here - clear after successful regeneration
            
            // Close any open section editors
            if (editingSectionIndex !== null) {
                setEditingSectionIndex(null);
                setEditedSectionContent('');
            }
            
            connectToStream(threadId); // Reconnect to get next chunks

        } catch (error) {
            console.error('Error submitting review:', error);
            setStatus('error');
        }
    };

    const connectToStream = (tid) => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }

        const url = `http://localhost:8000/custom/stream/${tid}`;
        const eventSource = new EventSource(url);
        eventSourceRef.current = eventSource;

        let incomingContent = "";

        eventSource.onopen = () => {
            console.log("Connection opened");
        };

        eventSource.addEventListener('token', (event) => {
            const data = JSON.parse(event.data);
            incomingContent += data.content;
            setCurrentChunkContent(incomingContent);
        });

        eventSource.addEventListener('status', (event) => {
            const data = JSON.parse(event.data);

            if (data.status === 'user_feedback') {
                setStatus('review');
                const newPlan = data.plan || [];
                const newIndex = data.current_index || 0;
                const newSections = data.generated_sections || [];
                
                // Update plan only if it's different (from backend)
                if (newPlan.length > 0 && JSON.stringify(newPlan) !== JSON.stringify(plan)) {
                    setPlan(newPlan);
                }
                
                setCurrentIndex(newIndex);
                setCompletedSections(newSections);
                const chunkContent = data.current_chunk || incomingContent;
                setCurrentChunkContent(chunkContent);
                // Initialize edit content with the generated chunk
                setEditedContent(chunkContent);
                // Reset edit mode when new content arrives
                setEditMode(false);
                
                // Store first generated version for comparison (only first time)
                if (newIndex < newSections.length) {
                    const firstVersions = [...firstGeneratedVersions];
                    if (firstVersions.length <= newIndex || !firstVersions[newIndex]) {
                        // This is the first time we're seeing this section
                        firstVersions[newIndex] = data.current_chunk || incomingContent;
                        setFirstGeneratedVersions(firstVersions);
                    }
                }
                
                // Update modified version if this is a regeneration
                // Check if we have a modified version stored for this index
                if (modifiedVersions[newIndex]) {
                    // This is a regeneration, keep the modified version for comparison
                    // But update current content to the newly generated one
                } else {
                    // First time, initialize modified version same as current
                    const modifiedList = [...modifiedVersions];
                    modifiedList[newIndex] = chunkContent;
                    setModifiedVersions(modifiedList);
                }
                
                eventSource.close();
            } else if (data.status === 'finished') {
                setStatus('finished');
                // Use modified versions if available, otherwise use generated sections
                const finalSections = data.generated_sections || [];
                const finalWithModifications = finalSections.map((sec, idx) => {
                    // If we have a modified version for this section, use it
                    return modifiedVersions[idx] || sec;
                });
                setCompletedSections(finalWithModifications);
                setCurrentChunkContent(''); // Clear current since it's now in completed
                // Clear all feedbacks after completion
                setAllSentenceFeedbacks([]);
                setSelectedText('');
                setSentenceFeedback('');
                eventSource.close();
            }
        });

        eventSource.addEventListener('error', (event) => {
            eventSource.close();
            // Only set error if we weren't expecting a close (e.g. network error)
            // But usually 'status' event handles the close logic.
        });
    };

    // Plan editing functions
    const startEditingPlan = (index) => {
        setEditingPlanIndex(index);
        setEditingPlanValue(plan[index] || '');
    };

    const savePlanEdit = () => {
        if (editingPlanIndex !== null) {
            const newPlan = [...plan];
            if (editingPlanValue.trim()) {
                newPlan[editingPlanIndex] = editingPlanValue.trim();
            } else {
                newPlan.splice(editingPlanIndex, 1);
            }
            setPlan(newPlan);
            setEditingPlanIndex(null);
            setEditingPlanValue('');
        }
    };

    const cancelPlanEdit = () => {
        setEditingPlanIndex(null);
        setEditingPlanValue('');
    };

    const addPlanItem = () => {
        const newPlan = [...plan, 'New Section'];
        setPlan(newPlan);
        setEditingPlanIndex(newPlan.length - 1);
        setEditingPlanValue('New Section');
    };

    const deletePlanItem = (index) => {
        if (window.confirm('Are you sure you want to delete this section?')) {
            const newPlan = plan.filter((_, i) => i !== index);
            setPlan(newPlan);
            if (index < currentIndex) {
                setCurrentIndex(Math.max(0, currentIndex - 1));
            }
        }
    };

    const movePlanItem = (index, direction) => {
        const newPlan = [...plan];
        const newIndex = index + direction;
        if (newIndex >= 0 && newIndex < plan.length) {
            [newPlan[index], newPlan[newIndex]] = [newPlan[newIndex], newPlan[index]];
            setPlan(newPlan);
            if (index === currentIndex) {
                setCurrentIndex(newIndex);
            } else if (newIndex === currentIndex) {
                setCurrentIndex(index);
            }
        }
    };

    // Handle text selection for sentence-level feedback
    useEffect(() => {
        if (status !== 'review' || editMode) {
            return;
        }

        let selectionTimeout = null;
        let justSelected = false;
        let clickOutsideHandler = null;

        const handleSelection = () => {
            // Don't process if clicking inside the popup
            const popup = document.querySelector('.sentence-feedback-popup');
            if (popup) {
                const activeElement = document.activeElement;
                if (popup.contains(activeElement) || activeElement?.closest('.sentence-feedback-popup')) {
                    return;
                }
            }

            // Clear any existing timeout
            if (selectionTimeout) {
                clearTimeout(selectionTimeout);
            }

            const selection = window.getSelection();
            const selectedText = selection.toString().trim();
            
            if (selectedText && selectedText.length > 0) {
                // Check if selection is within any markdown content area
                const markdownContainers = document.querySelectorAll('.markdown-content');
                let isInMarkdown = false;
                
                for (const container of markdownContainers) {
                    if (selection.anchorNode && container.contains(selection.anchorNode)) {
                        isInMarkdown = true;
                        break;
                    }
                }
                
                if (isInMarkdown) {
                    // Use a small delay to prevent immediate closing
                    selectionTimeout = setTimeout(() => {
                        setSelectedText(selectedText);
                        setShowSentenceFeedback(true);
                        justSelected = true;
                        
                        // Reset flag after a short delay
                        setTimeout(() => {
                            justSelected = false;
                        }, 300);
                    }, 150);
                } else if (!justSelected && !showSentenceFeedback) {
                    // Clear selection if not in markdown area
                    setShowSentenceFeedback(false);
                    setSelectedText('');
                }
            } else if (!justSelected && !showSentenceFeedback) {
                // Clear if no selection
                setShowSentenceFeedback(false);
                setSelectedText('');
            }
        };

        clickOutsideHandler = (e) => {
            // Don't close if clicking inside the popup or if we just selected
            if (justSelected) {
                return;
            }
            
            if (showSentenceFeedback) {
                const popup = document.querySelector('.sentence-feedback-popup');
                if (popup) {
                    const isClickInPopup = popup.contains(e.target) || 
                                         e.target.closest('.sentence-feedback-popup') ||
                                         e.target.classList?.contains('sentence-feedback-input') ||
                                         e.target.classList?.contains('sentence-feedback-submit') ||
                                         e.target.classList?.contains('sentence-feedback-close');
                    
                    if (!isClickInPopup) {
                        setShowSentenceFeedback(false);
                        setSelectedText('');
                        setSentenceFeedback('');
                        window.getSelection().removeAllRanges();
                    }
                }
            }
        };

        document.addEventListener('mouseup', handleSelection);
        document.addEventListener('keyup', handleSelection);
        document.addEventListener('click', clickOutsideHandler, true);

        return () => {
            if (selectionTimeout) {
                clearTimeout(selectionTimeout);
            }
            document.removeEventListener('mouseup', handleSelection);
            document.removeEventListener('keyup', handleSelection);
            if (clickOutsideHandler) {
                document.removeEventListener('click', clickOutsideHandler, true);
            }
        };
    }, [status, editMode, showSentenceFeedback]);

    // Sync editedContent when entering review mode
    useEffect(() => {
        if (status === 'review' && currentChunkContent && !editedContent) {
            setEditedContent(currentChunkContent);
        }
    }, [status, currentChunkContent]);

    // Cleanup
    useEffect(() => {
        return () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
            }
        };
    }, []);

    return (
        <div className="hitl-container">
            <h1 className="hitl-header">Iterative Content Generator (HITL)</h1>

            {/* Input Section */}
            <div className="hitl-input-card">
                <div className="hitl-input-group">
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="What would you like to write about?"
                        className="chat-input"
                        disabled={status !== 'idle' && status !== 'finished'}
                    />
                    <button
                        onClick={startWorkflow}
                        disabled={!query || (status !== 'idle' && status !== 'finished')}
                        className="btn-primary"
                    >
                        {status === 'running' ? 'Generating...' : 'Start New'}
                    </button>
                </div>
            </div>

            {/* Main Workflow Area */}
            {(status !== 'idle') && (
                <div className="hitl-main-area">

                    {/* Left Sidebar: Plan/Progress */}
                    <div className="hitl-sidebar">
                        <div className="plan-header-row">
                            <h3>Writing Plan</h3>
                            {plan.length > 0 && (
                                <button
                                    onClick={addPlanItem}
                                    className="plan-add-btn"
                                    title="Add new section"
                                >
                                    +
                                </button>
                            )}
                        </div>
                        <ul className="plan-list">
                            {plan.length === 0 ? (
                                <li className="plan-item pending">Generating plan...</li>
                            ) : (
                                plan.map((section, idx) => {
                                    let statusClass = 'pending';
                                    if (idx < currentIndex || status === 'finished') statusClass = 'completed';
                                    else if (idx === currentIndex && status !== 'finished') statusClass = 'active';

                                    const isEditing = editingPlanIndex === idx;

                                    return (
                                        <li key={idx} className={`plan-item ${statusClass} ${isEditing ? 'editing' : ''}`}>
                                            <span className="status-icon">
                                                {(idx < currentIndex || status === 'finished') ? '✓' : (idx + 1) + '.'}
                                            </span>
                                            {isEditing ? (
                                                <div className="plan-edit-container">
                                                    <input
                                                        type="text"
                                                        value={editingPlanValue}
                                                        onChange={(e) => setEditingPlanValue(e.target.value)}
                                                        onBlur={savePlanEdit}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                e.preventDefault();
                                                                savePlanEdit();
                                                            } else if (e.key === 'Escape') {
                                                                cancelPlanEdit();
                                                            }
                                                        }}
                                                        className="plan-edit-input"
                                                        autoFocus
                                                    />
                                                </div>
                                            ) : (
                                                <>
                                                    <span
                                                        className="plan-item-text"
                                                        onClick={() => startEditingPlan(idx)}
                                                        title="Click to edit"
                                                    >
                                                        {section}
                                                    </span>
                                                    <div className="plan-item-actions">
                                                        <button
                                                            onClick={() => movePlanItem(idx, -1)}
                                                            className="plan-action-btn"
                                                            disabled={idx === 0}
                                                            title="Move up"
                                                        >
                                                            ↑
                                                        </button>
                                                        <button
                                                            onClick={() => movePlanItem(idx, 1)}
                                                            className="plan-action-btn"
                                                            disabled={idx === plan.length - 1}
                                                            title="Move down"
                                                        >
                                                            ↓
                                                        </button>
                                                        <button
                                                            onClick={() => deletePlanItem(idx)}
                                                            className="plan-action-btn plan-delete-btn"
                                                            title="Delete"
                                                        >
                                                            ×
                                                        </button>
                                                    </div>
                                                </>
                                            )}
                                        </li>
                                    );
                                })
                            )}
                        </ul>
                        {plan.length === 0 && status !== 'idle' && (
                            <button
                                onClick={addPlanItem}
                                className="plan-add-first-btn"
                            >
                                + Add Section
                            </button>
                        )}
                    </div>

                    {/* Right Content Area */}
                    <div className="hitl-content-area">

                        {/* 1. Previously Completed Sections */}
                        {completedSections.map((sec, idx) => {
                            // Check if this section has been modified
                            const isModified = modifiedVersions[idx] && modifiedVersions[idx] !== firstGeneratedVersions[idx];
                            
                            return (
                            // Only show sections BEFORE the current index unless finished
                            (idx < currentIndex || status === 'finished') && (
                                <div key={idx} className="section-card">
                                    <div className="section-header-row">
                                        <div className="section-header">
                                            Section {idx + 1}: {plan[idx]}
                                            {isModified && <span className="modified-badge" title="This section has been modified"> (Modified)</span>}
                                        </div>
                                        <button
                                            onClick={() => {
                                                if (editingSectionIndex === idx) {
                                                    // Save edits
                                                    const updatedSections = [...completedSections];
                                                    updatedSections[idx] = editedSectionContent;
                                                    setCompletedSections(updatedSections);
                                                    
                                                    // Mark as modified
                                                    const updatedModified = [...modifiedVersions];
                                                    updatedModified[idx] = editedSectionContent;
                                                    setModifiedVersions(updatedModified);
                                                    
                                                    setEditingSectionIndex(null);
                                                    setEditedSectionContent('');
                                                } else {
                                                    // Start editing
                                                    setEditingSectionIndex(idx);
                                                    setEditedSectionContent(sec);
                                                }
                                            }}
                                            className="edit-toggle-btn"
                                        >
                                            {editingSectionIndex === idx ? 'Save' : 'Edit'}
                                        </button>
                                        {editingSectionIndex === idx && (
                                            <button
                                                onClick={() => {
                                                    setEditingSectionIndex(null);
                                                    setEditedSectionContent('');
                                                }}
                                                className="edit-toggle-btn"
                                                style={{ marginLeft: '0.5rem' }}
                                            >
                                                Cancel
                                            </button>
                                        )}
                                    </div>
                                    {editingSectionIndex === idx ? (
                                        <textarea
                                            value={editedSectionContent}
                                            onChange={(e) => setEditedSectionContent(e.target.value)}
                                            className="edit-textarea"
                                            style={{ marginTop: '1rem', width: '100%', minHeight: '200px' }}
                                        />
                                    ) : (
                                        <div className="markdown-content" style={{ userSelect: 'text' }}>
                                            <ReactMarkdown>{sec}</ReactMarkdown>
                                        </div>
                                    )}
                                </div>
                            )
                        )})}

                        {/* 2. Current Active Section */}
                        {status !== 'finished' && (
                            <div className={`current-section-card ${status === 'running' ? 'running' : ''}`}>
                                <div className="current-section-header-row">
                                    <span className="current-section-title">
                                        {status === 'running' ? 'Generating...' : 'Reviewing Current Section'}
                                    </span>
                                    {status === 'review' && (
                                        <button
                                            onClick={() => {
                                                if (!editMode) {
                                                    // Entering edit mode - sync editedContent with current content
                                                    setEditedContent(editedContent || currentChunkContent);
                                                }
                                                setEditMode(!editMode);
                                            }}
                                            className="edit-toggle-btn"
                                        >
                                            {editMode ? 'Cancel Edit' : 'Edit Text'}
                                        </button>
                                    )}
                                </div>

                                {/* Content Display / Edit Area */}
                                {editMode ? (
                                    <textarea
                                        value={editedContent}
                                        onChange={(e) => setEditedContent(e.target.value)}
                                        className="edit-textarea"
                                        style={{ width: '100%', minHeight: '300px' }}
                                    />
                                ) : (
                                    <div className="markdown-content-container">
                                        <div className="markdown-content" style={{ minHeight: '150px', userSelect: 'text' }}>
                                            <ReactMarkdown>{status === 'running' ? currentChunkContent : (editedContent || currentChunkContent)}</ReactMarkdown>
                                        </div>
                                        
                                        {/* Sentence Feedback Popup */}
                                        {showSentenceFeedback && selectedText && (
                                            <div 
                                                className="sentence-feedback-popup"
                                                onClick={(e) => e.stopPropagation()}
                                                onMouseDown={(e) => e.stopPropagation()}
                                            >
                                                <div 
                                                    className="sentence-feedback-header"
                                                    onClick={(e) => e.stopPropagation()}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                >
                                                    <span>Feedback for: "{selectedText.substring(0, 30)}{selectedText.length > 30 ? '...' : ''}"</span>
                                                    <button 
                                                        className="sentence-feedback-close"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            e.preventDefault();
                                                            setShowSentenceFeedback(false);
                                                            setSelectedText('');
                                                            setSentenceFeedback('');
                                                            window.getSelection().removeAllRanges();
                                                        }}
                                                        onMouseDown={(e) => e.stopPropagation()}
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                                <textarea
                                                    value={sentenceFeedback}
                                                    onChange={(e) => setSentenceFeedback(e.target.value)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    onFocus={(e) => e.stopPropagation()}
                                                    placeholder="E.g., Make this more concise, add more detail..."
                                                    className="sentence-feedback-input"
                                                    rows="3"
                                                />
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        e.preventDefault();
                                                        // Save the feedback to array and close popup
                                                        if (sentenceFeedback.trim() && selectedText) {
                                                            // Add to allSentenceFeedbacks array
                                                            const newFeedback = {
                                                                text: selectedText,
                                                                feedback: sentenceFeedback.trim()
                                                            };
                                                            // Check if already exists
                                                            const exists = allSentenceFeedbacks.some(fb => 
                                                                fb.text === selectedText && fb.feedback === sentenceFeedback.trim()
                                                            );
                                                            if (!exists) {
                                                                setAllSentenceFeedbacks([...allSentenceFeedbacks, newFeedback]);
                                                            }
                                                            // Clear current selection
                                                            setShowSentenceFeedback(false);
                                                            setSelectedText('');
                                                            setSentenceFeedback('');
                                                            window.getSelection().removeAllRanges();
                                                        } else {
                                                            // If no feedback, just close
                                                            setShowSentenceFeedback(false);
                                                            setSelectedText('');
                                                            setSentenceFeedback('');
                                                            window.getSelection().removeAllRanges();
                                                        }
                                                    }}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    className="sentence-feedback-submit"
                                                    disabled={!sentenceFeedback.trim()}
                                                >
                                                    {sentenceFeedback.trim() ? 'Save Feedback' : 'Close'}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                                
                                {/* Comparison Toggle */}
                                {status === 'review' && firstGeneratedVersions[currentIndex] && (
                                    <div className="comparison-toggle">
                                        <button
                                            onClick={() => setShowComparison(!showComparison)}
                                            className="btn-comparison"
                                        >
                                            {showComparison ? 'Hide' : 'Show'} Comparison
                                        </button>
                                    </div>
                                )}
                                
                                {/* Document Comparison View */}
                                {showComparison && firstGeneratedVersions[currentIndex] && (
                                    <div className="comparison-view">
                                        <div className="comparison-panel">
                                            <h4>Original (First Generated)</h4>
                                            <div className="markdown-content comparison-content">
                                                <ReactMarkdown>{firstGeneratedVersions[currentIndex]}</ReactMarkdown>
                                            </div>
                                        </div>
                                        <div className="comparison-panel">
                                            <h4>Final Version (After All Edits & Feedback)</h4>
                                            <div className="markdown-content comparison-content">
                                                <ReactMarkdown>{editedContent || modifiedVersions[currentIndex] || currentChunkContent}</ReactMarkdown>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Review Controls */}
                                {status === 'review' && (
                                    <div className="review-controls">

                                        {/* All Sentence Feedbacks Display */}
                                        {allSentenceFeedbacks.length > 0 && (
                                            <div className="all-sentence-feedbacks">
                                                <div className="sentence-feedback-label">
                                                    Sentence Feedbacks ({allSentenceFeedbacks.length}):
                                                </div>
                                                {allSentenceFeedbacks.map((fb, idx) => (
                                                    <div key={idx} className="sentence-feedback-display">
                                                        <div className="sentence-feedback-text">
                                                            <strong>"{fb.text.substring(0, 50)}{fb.text.length > 50 ? '...' : ''}"</strong>: {fb.feedback}
                                                        </div>
                                                        <button
                                                            onClick={() => {
                                                                setAllSentenceFeedbacks(allSentenceFeedbacks.filter((_, i) => i !== idx));
                                                            }}
                                                            className="sentence-feedback-remove"
                                                        >
                                                            Remove
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        
                                        {/* Current Sentence Feedback (if not yet saved) */}
                                        {selectedText && sentenceFeedback && !allSentenceFeedbacks.some(fb => fb.text === selectedText && fb.feedback === sentenceFeedback.trim()) && (
                                            <div className="sentence-feedback-display">
                                                <div className="sentence-feedback-label">
                                                    Current Sentence Feedback (not saved yet):
                                                </div>
                                                <div className="sentence-feedback-text">
                                                    <strong>"{selectedText.substring(0, 50)}{selectedText.length > 50 ? '...' : ''}"</strong>: {sentenceFeedback}
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        setSelectedText('');
                                                        setSentenceFeedback('');
                                                        window.getSelection().removeAllRanges();
                                                    }}
                                                    className="sentence-feedback-remove"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        )}

                                        {/* Feedback Input */}
                                        <div className="review-input-group">
                                            <label className="review-label">
                                                General Feedback (Optional if approving)
                                            </label>
                                            <input
                                                type="text"
                                                value={feedback}
                                                onChange={(e) => setFeedback(e.target.value)}
                                                placeholder="E.g., Make it shorter, add more examples..."
                                                className="review-feedback-input"
                                            />
                                        </div>

                                        {/* Action Buttons */}
                                        <div className="review-actions">
                                            <button
                                                onClick={() => submitReview('feedback')}
                                                disabled={!feedback && !editMode && allSentenceFeedbacks.length === 0 && !(selectedText && sentenceFeedback)}
                                                className="btn-regenerate"
                                            >
                                                Regenerate with Feedback
                                            </button>
                                            <button
                                                onClick={() => submitReview('approved')}
                                                className="btn-approve"
                                            >
                                                {editMode ? 'Approve Edits & Continue' : 'Approve & Continue'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {status === 'finished' && (
                            <div className="success-card">
                                <h3>🎉 Generation Complete!</h3>
                                <p>All sections have been approved and finalized.</p>
                            </div>
                        )}

                    </div>
                </div>
            )}
        </div>
    );
};

export default HitlWorkflow;
