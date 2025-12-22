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

    // Edit & Feedback State
    const [editMode, setEditMode] = useState(false);
    const [editedContent, setEditedContent] = useState('');
    const [feedback, setFeedback] = useState('');

    const eventSourceRef = useRef(null);

    const startWorkflow = async () => {
        try {
            setStatus('running');
            setPlan([]);
            setCompletedSections([]);
            setCurrentChunkContent('');
            setCurrentIndex(0);

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

            const payload = {
                thread_id: threadId,
                review_action: action,
                human_comment: action === 'feedback' ? feedback : null,
                edited_content: editMode ? editedContent : null
            };

            await fetch('http://localhost:8000/custom/resume', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            // Reset local review state
            setFeedback('');
            setEditMode(false);
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
                setPlan(data.plan || []);
                setCurrentIndex(data.current_index || 0);
                setCompletedSections(data.generated_sections || []);
                setCurrentChunkContent(data.current_chunk || incomingContent);
                // Initialize edit content with the generated chunk
                setEditedContent(data.current_chunk || incomingContent);
                eventSource.close();
            } else if (data.status === 'finished') {
                setStatus('finished');
                setCompletedSections(data.generated_sections || []);
                setCurrentChunkContent(''); // Clear current since it's now in completed
                eventSource.close();
            }
        });

        eventSource.addEventListener('error', (event) => {
            eventSource.close();
            // Only set error if we weren't expecting a close (e.g. network error)
            // But usually 'status' event handles the close logic.
        });
    };

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
                        <h3>Writing Plan</h3>
                        <ul className="plan-list">
                            {plan.length === 0 ? (
                                <li className="plan-item pending">Generating plan...</li>
                            ) : (
                                plan.map((section, idx) => {
                                    let statusClass = 'pending';
                                    if (idx < currentIndex || status === 'finished') statusClass = 'completed';
                                    else if (idx === currentIndex && status !== 'finished') statusClass = 'active';

                                    return (
                                        <li key={idx} className={`plan-item ${statusClass}`}>
                                            <span className="status-icon">
                                                {(idx < currentIndex || status === 'finished') ? '✓' : (idx + 1) + '.'}
                                            </span>
                                            {section}
                                        </li>
                                    );
                                })
                            )}
                        </ul>
                    </div>

                    {/* Right Content Area */}
                    <div className="hitl-content-area">

                        {/* 1. Previously Completed Sections */}
                        {completedSections.map((sec, idx) => (
                            // Only show sections BEFORE the current index unless finished
                            (idx < currentIndex || status === 'finished') && (
                                <div key={idx} className="section-card">
                                    <div className="section-header">Section {idx + 1}: {plan[idx]}</div>
                                    <div className="markdown-content">
                                        <ReactMarkdown>{sec}</ReactMarkdown>
                                    </div>
                                </div>
                            )
                        ))}

                        {/* 2. Current Active Section */}
                        {status !== 'finished' && (
                            <div className={`current-section-card ${status === 'running' ? 'running' : ''}`}>
                                <div className="current-section-header-row">
                                    <span className="current-section-title">
                                        {status === 'running' ? 'Generating...' : 'Reviewing Current Section'}
                                    </span>
                                    {status === 'review' && (
                                        <button
                                            onClick={() => setEditMode(!editMode)}
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
                                    />
                                ) : (
                                    <div className="markdown-content" style={{ minHeight: '150px' }}>
                                        <ReactMarkdown>{status === 'running' ? currentChunkContent : (editedContent || currentChunkContent)}</ReactMarkdown>
                                    </div>
                                )}

                                {/* Review Controls */}
                                {status === 'review' && (
                                    <div className="review-controls">

                                        {/* Feedback Input */}
                                        <div className="review-input-group">
                                            <label className="review-label">
                                                Feedback (Optional if approving)
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
                                                disabled={!feedback && !editMode}
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
