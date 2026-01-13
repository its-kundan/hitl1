import React, { useState, useEffect } from 'react';
import './SentenceFeedback.css'; // Styles (see CSS section below)

/**
 * Reusable Sentence Feedback Component
 * 
 * Usage:
 * <SentenceFeedback
 *   enabled={true} // Enable/disable selection
 *   targetSelector=".content-area" // CSS selector for selectable content
 *   onFeedbackSubmit={(selectedText, feedback) => {
 *     // Handle feedback submission
 *     console.log('Selected:', selectedText);
 *     console.log('Feedback:', feedback);
 *   }}
 *   placeholder="E.g., Make this more concise, add more detail..."
 * />
 */
const SentenceFeedback = ({
  enabled = true,
  targetSelector = '.selectable-content',
  onFeedbackSubmit,
  placeholder = "Provide feedback for this selection..."
}) => {
  const [selectedText, setSelectedText] = useState('');
  const [showPopup, setShowPopup] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [allFeedbacks, setAllFeedbacks] = useState([]);

  useEffect(() => {
    if (!enabled) {
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
        // Check if selection is within target area
        const targetContainers = document.querySelectorAll(targetSelector);
        let isInTarget = false;
                
        for (const container of targetContainers) {
          if (selection.anchorNode && container.contains(selection.anchorNode)) {
            isInTarget = true;
            break;
          }
        }
                
        if (isInTarget) {
          // Use a small delay to prevent immediate closing
          selectionTimeout = setTimeout(() => {
            setSelectedText(selectedText);
            setShowPopup(true);
            justSelected = true;
                        
            // Reset flag after a short delay
            setTimeout(() => {
              justSelected = false;
            }, 300);
          }, 150);
        } else if (!justSelected && !showPopup) {
          // Clear selection if not in target area
          setShowPopup(false);
          setSelectedText('');
        }
      } else if (!justSelected && !showPopup) {
        // Clear if no selection
        setShowPopup(false);
        setSelectedText('');
      }
    };

    clickOutsideHandler = (e) => {
      // Don't close if clicking inside the popup or if we just selected
      if (justSelected) {
        return;
      }
            
      if (showPopup) {
        const popup = document.querySelector('.sentence-feedback-popup');
        if (popup) {
          const isClickInPopup = popup.contains(e.target) ||
                                e.target.closest('.sentence-feedback-popup') ||
                               e.target.classList?.contains('sentence-feedback-input') ||
                               e.target.classList?.contains('sentence-feedback-submit') ||
                               e.target.classList?.contains('sentence-feedback-close');
                    
          if (!isClickInPopup) {
            setShowPopup(false);
            setSelectedText('');
            setFeedback('');
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
  }, [enabled, showPopup, targetSelector]);

  const handleSubmit = (e) => {
    e.stopPropagation();
    e.preventDefault();
        
    if (feedback.trim() && selectedText) {
      const newFeedback = {
        text: selectedText,
        feedback: feedback.trim(),
        id: Date.now() // Unique ID for tracking
      };
            
      // Add to local state
      setAllFeedbacks([...allFeedbacks, newFeedback]);
            
      // Call callback if provided
      if (onFeedbackSubmit) {
        onFeedbackSubmit(selectedText, feedback.trim());
      }
            
      // Clear and close
      setShowPopup(false);
      setSelectedText('');
      setFeedback('');
      window.getSelection().removeAllRanges();
    } else {
      // Just close if no feedback
      setShowPopup(false);
      setSelectedText('');
      setFeedback('');
      window.getSelection().removeAllRanges();
    }
  };

  const handleClose = (e) => {
    e.stopPropagation();
    e.preventDefault();
    setShowPopup(false);
    setSelectedText('');
    setFeedback('');
    window.getSelection().removeAllRanges();
  };

  const removeFeedback = (id) => {
    setAllFeedbacks(allFeedbacks.filter(fb => fb.id !== id));
  };

  return (
    <>
      {/* Popup Dialog */}
      {showPopup && selectedText && (
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
            <span>
              Feedback for: "{selectedText.substring(0, 30)}{selectedText.length > 30 ? '...' : ''}"
            </span>
            <button 
              className="sentence-feedback-close"
              onClick={handleClose}
              onMouseDown={(e) => e.stopPropagation()}
            >
              ×
            </button>
          </div>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onFocus={(e) => e.stopPropagation()}
            placeholder={placeholder}
            className="sentence-feedback-input"
            rows="3"
            autoFocus
          />
          <button
            onClick={handleSubmit}
            onMouseDown={(e) => e.stopPropagation()}
            className="sentence-feedback-submit"
            disabled={!feedback.trim()}
          >
            {feedback.trim() ? 'Save Feedback' : 'Close'}
          </button>
        </div>
      )}

      {/* Display Saved Feedbacks (Optional) */}
      {allFeedbacks.length > 0 && (
        <div className="all-sentence-feedbacks">
          <div className="sentence-feedback-label">
            Saved Feedbacks ({allFeedbacks.length}):
          </div>
          {allFeedbacks.map((fb) => (
            <div key={fb.id} className="sentence-feedback-display">
              <div className="sentence-feedback-text">
                <strong>"{fb.text.substring(0, 50)}{fb.text.length > 50 ? '...' : ''}"</strong>: {fb.feedback}
              </div>
              <button
                onClick={() => removeFeedback(fb.id)}
                className="sentence-feedback-remove"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

export default SentenceFeedback;
