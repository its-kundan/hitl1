// AssistantService.js
// Centralized service for assistant session/conversation API calls

const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

export default class AssistantService {
  // Original blocking API methods
  static async startConversation(human_request) {
    try {
      const response = await fetch(`${BASE_URL}/graph/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ human_request })
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error (${response.status}): ${errorText || 'Network response was not ok'}`);
      }
      return response.json();
    } catch (error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`);
      }
      throw error;
    }
  }

  static async submitReview({ thread_id, review_action, human_comment }) {
    try {
      const body = { thread_id, review_action };
      if (human_comment) body.human_comment = human_comment;
      const response = await fetch(`${BASE_URL}/graph/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error (${response.status}): ${errorText || 'Network response was not ok'}`);
      }
      return response.json();
    } catch (error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`);
      }
      throw error;
    }
  }

  // New streaming API methods
  static async createStreamingConversation(human_request) {
    try {
      const response = await fetch(`${BASE_URL}/graph/stream/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ human_request })
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error (${response.status}): ${errorText || 'Network response was not ok'}`);
      }
      return response.json();
    } catch (error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`);
      }
      throw error;
    }
  }

  static async resumeStreamingConversation({ thread_id, review_action, human_comment }) {
    try {
      const body = { thread_id, review_action };
      if (human_comment) body.human_comment = human_comment;
      const response = await fetch(`${BASE_URL}/graph/stream/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error (${response.status}): ${errorText || 'Network response was not ok'}`);
      }
      return response.json();
    } catch (error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`);
      }
      throw error;
    }
  }

  static streamResponse(thread_id, onMessageCallback, onErrorCallback, onCompleteCallback) {
    // Create a new EventSource connection to the streaming endpoint
    let eventSource;
    let streamCompletedNormally = false;
    let hasReceivedStatusEvent = false;
    
    try {
      eventSource = new EventSource(`${BASE_URL}/graph/stream/${thread_id}`);
    } catch (error) {
      onErrorCallback(new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`));
      return null;
    }
    
    // Handle token events (content streaming)
    eventSource.addEventListener('token', (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessageCallback({ content: data.content });
      } catch (error) {
        console.error("Error parsing token event:", error, "Raw data:", event.data);
        onErrorCallback(error);
      }
    });
    
    // Handle status events (user_feedback, finished)
    eventSource.addEventListener('status', (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessageCallback({ status: data.status });
        
        // Mark that we've received a status event indicating normal completion
        hasReceivedStatusEvent = true;
        console.log("Received status event, marking connection for normal closure");
        
        // Close the connection after a short delay to allow final messages to be processed
        setTimeout(() => {
          if (!streamCompletedNormally) {
            streamCompletedNormally = true;
            eventSource.close();
            onCompleteCallback();
          }
        }, 100);
      } catch (error) {
        console.error("Error parsing status event:", error, "Raw data:", event.data);
        onErrorCallback(error);
      }
    });
    
    // Handle start/resume events
    eventSource.addEventListener('start', (event) => {
      console.log("Stream started:", event.data);
    });
    
    eventSource.addEventListener('resume', (event) => {
      console.log("Stream resumed:", event.data);
    });
    
    // Handle error events from the backend (explicit error events, not connection errors)
    eventSource.addEventListener('error', (event) => {
      try {
        const data = JSON.parse(event.data);
        const errorMessage = data.error || "Unknown error occurred";
        console.error("Backend error event:", errorMessage);
        streamCompletedNormally = true; // Prevent onerror from firing
        eventSource.close();
        onErrorCallback(new Error(errorMessage));
      } catch (error) {
        console.error("Error parsing error event:", error, "Raw data:", event.data);
        streamCompletedNormally = true;
        eventSource.close();
        onErrorCallback(new Error(event.data || "Unknown error occurred"));
      }
    });
    
    // Handle connection errors (this fires when the connection closes)
    eventSource.onerror = (error) => {
      // If we've already handled completion or error, ignore this
      if (streamCompletedNormally) {
        return;
      }
      
      console.log("SSE connection state change - readyState:", eventSource.readyState);
      
      // If we received a status event, this is a normal closure
      if (hasReceivedStatusEvent) {
        console.log("Stream completed normally after receiving status event");
        streamCompletedNormally = true;
        eventSource.close();
        onCompleteCallback();
        return;
      }
      
      // If the connection is closed or closing, and we haven't received a status event,
      // check if it's a real error or just a normal close
      if (eventSource.readyState === EventSource.CLOSED) {
        // Connection is closed - if we haven't received a status event, it might be an error
        // But wait a bit to see if status event arrives (race condition)
        setTimeout(() => {
          if (!hasReceivedStatusEvent && !streamCompletedNormally) {
            console.error("SSE connection closed without status event - treating as error");
            streamCompletedNormally = true;
            onErrorCallback(new Error("Connection closed unexpectedly"));
          }
        }, 500);
      } else if (eventSource.readyState === EventSource.CONNECTING) {
        // Still connecting - not an error yet
        console.log("SSE still connecting...");
      } else {
        // OPEN state but error fired - might be a real error
        console.log("SSE in OPEN state with error event - monitoring...");
      }
    };
    
    // Return the eventSource so it can be closed externally if needed
    return eventSource;
  }

  // Custom workflow API methods (Lesson 4)
  static async createCustomWorkflow(human_request) {
    try {
      const response = await fetch(`${BASE_URL}/custom/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ human_request })
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error (${response.status}): ${errorText || 'Network response was not ok'}`);
      }
      return response.json();
    } catch (error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`);
      }
      throw error;
    }
  }

  static async resumeCustomWorkflow({ thread_id, review_action, human_comment }) {
    try {
      const body = { thread_id, review_action };
      if (human_comment) body.human_comment = human_comment;
      const response = await fetch(`${BASE_URL}/custom/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error (${response.status}): ${errorText || 'Network response was not ok'}`);
      }
      return response.json();
    } catch (error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`);
      }
      throw error;
    }
  }

  static streamCustomWorkflow(thread_id, onMessageCallback, onErrorCallback, onCompleteCallback) {
    // Create a new EventSource connection to the custom workflow streaming endpoint
    let eventSource;
    let streamCompletedNormally = false;
    let hasReceivedStatusEvent = false;
    
    try {
      eventSource = new EventSource(`${BASE_URL}/custom/stream/${thread_id}`);
    } catch (error) {
      onErrorCallback(new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`));
      return null;
    }
    
    // Handle token events (content streaming from research, draft, or finalize nodes)
    eventSource.addEventListener('token', (event) => {
      try {
        const data = JSON.parse(event.data);
        // Include node information if available
        onMessageCallback({ 
          content: data.content,
          node: data.node // 'research', 'draft', or 'finalize'
        });
      } catch (error) {
        console.error("Error parsing token event:", error, "Raw data:", event.data);
        onErrorCallback(error);
      }
    });
    
    // Handle status events (user_feedback, finished)
    eventSource.addEventListener('status', (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessageCallback({ 
          status: data.status,
          draft_content: data.draft_content,
          final_output: data.final_output
        });
        
        // Mark that we've received a status event indicating normal completion
        hasReceivedStatusEvent = true;
        console.log("Received status event, marking connection for normal closure");
        
        // Close the connection after a short delay to allow final messages to be processed
        setTimeout(() => {
          if (!streamCompletedNormally) {
            streamCompletedNormally = true;
            eventSource.close();
            onCompleteCallback();
          }
        }, 100);
      } catch (error) {
        console.error("Error parsing status event:", error, "Raw data:", event.data);
        onErrorCallback(error);
      }
    });
    
    // Handle start/resume events
    eventSource.addEventListener('start', (event) => {
      console.log("Custom workflow stream started:", event.data);
    });
    
    eventSource.addEventListener('resume', (event) => {
      console.log("Custom workflow stream resumed:", event.data);
    });
    
    // Handle error events from the backend (explicit error events, not connection errors)
    eventSource.addEventListener('error', (event) => {
      try {
        const data = JSON.parse(event.data);
        const errorMessage = data.error || "Unknown error occurred";
        console.error("Backend error event:", errorMessage);
        streamCompletedNormally = true; // Prevent onerror from firing
        eventSource.close();
        onErrorCallback(new Error(errorMessage));
      } catch (error) {
        console.error("Error parsing error event:", error, "Raw data:", event.data);
        streamCompletedNormally = true;
        eventSource.close();
        onErrorCallback(new Error(event.data || "Unknown error occurred"));
      }
    });
    
    // Handle connection errors (this fires when the connection closes)
    eventSource.onerror = (error) => {
      // If we've already handled completion or error, ignore this
      if (streamCompletedNormally) {
        return;
      }
      
      console.log("SSE connection state change - readyState:", eventSource.readyState);
      
      // If we received a status event, this is a normal closure
      if (hasReceivedStatusEvent) {
        console.log("Stream completed normally after receiving status event");
        streamCompletedNormally = true;
        eventSource.close();
        onCompleteCallback();
        return;
      }
      
      // If the connection is closed or closing, and we haven't received a status event,
      // check if it's a real error or just a normal close
      if (eventSource.readyState === EventSource.CLOSED) {
        // Connection is closed - if we haven't received a status event, it might be an error
        // But wait a bit to see if status event arrives (race condition)
        setTimeout(() => {
          if (!hasReceivedStatusEvent && !streamCompletedNormally) {
            console.error("SSE connection closed without status event - treating as error");
            streamCompletedNormally = true;
            onErrorCallback(new Error("Connection closed unexpectedly"));
          }
        }, 500);
      } else if (eventSource.readyState === EventSource.CONNECTING) {
        // Still connecting - not an error yet
        console.log("SSE still connecting...");
      } else {
        // OPEN state but error fired - might be a real error
        console.log("SSE in OPEN state with error event - monitoring...");
      }
    };
    
    return eventSource;
  }

  // Data Analysis Workflow API methods (Lesson 5)
  static async resumeDataAnalysis({ thread_id, review_action, human_comment }) {
    try {
      const body = { thread_id, review_action };
      if (human_comment) body.human_comment = human_comment;
      const response = await fetch(`${BASE_URL}/data-analysis/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error (${response.status}): ${errorText || 'Network response was not ok'}`);
      }
      return response.json();
    } catch (error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`);
      }
      throw error;
    }
  }

  static streamDataAnalysis(thread_id, onMessageCallback, onErrorCallback, onCompleteCallback) {
    // Create a new EventSource connection to the data analysis streaming endpoint
    let eventSource;
    let streamCompletedNormally = false;
    let hasReceivedStatusEvent = false;
    
    try {
      eventSource = new EventSource(`${BASE_URL}/data-analysis/stream/${thread_id}`);
    } catch (error) {
      onErrorCallback(new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`));
      return null;
    }
    
    // Handle token events (content streaming from various nodes)
    eventSource.addEventListener('token', (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessageCallback({ 
          content: data.content,
          node: data.node
        });
      } catch (error) {
        console.error("Error parsing token event:", error, "Raw data:", event.data);
        onErrorCallback(error);
      }
    });
    
    // Handle status events (user_feedback, code_review, finished)
    eventSource.addEventListener('status', (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessageCallback({ 
          status: data.status,
          draft_content: data.draft_content,
          code: data.code,
          visualization_path: data.visualization_path,
          visualization_paths: data.visualization_paths,
          analysis_plan: data.analysis_plan,
          final_output: data.final_output,
          current_stage: data.current_stage
        });
        
        // Mark that we've received a status event indicating normal completion
        hasReceivedStatusEvent = true;
        console.log("Received status event, marking connection for normal closure");
        
        // Close the connection after a short delay to allow final messages to be processed
        setTimeout(() => {
          if (!streamCompletedNormally) {
            streamCompletedNormally = true;
            eventSource.close();
            onCompleteCallback();
          }
        }, 100);
      } catch (error) {
        console.error("Error parsing status event:", error, "Raw data:", event.data);
        onErrorCallback(error);
      }
    });
    
    // Handle start/resume events
    eventSource.addEventListener('start', (event) => {
      console.log("Data analysis stream started:", event.data);
    });
    
    eventSource.addEventListener('resume', (event) => {
      console.log("Data analysis stream resumed:", event.data);
    });
    
    // Handle error events from the backend (explicit error events, not connection errors)
    eventSource.addEventListener('error', (event) => {
      try {
        const data = JSON.parse(event.data);
        const errorMessage = data.error || "Unknown error occurred";
        console.error("Backend error event:", errorMessage);
        streamCompletedNormally = true; // Prevent onerror from firing
        eventSource.close();
        onErrorCallback(new Error(errorMessage));
      } catch (error) {
        console.error("Error parsing error event:", error, "Raw data:", event.data);
        streamCompletedNormally = true;
        eventSource.close();
        onErrorCallback(new Error(event.data || "Unknown error occurred"));
      }
    });
    
    // Handle connection errors (this fires when the connection closes)
    eventSource.onerror = (error) => {
      // If we've already handled completion or error, ignore this
      if (streamCompletedNormally) {
        return;
      }
      
      console.log("SSE connection state change - readyState:", eventSource.readyState);
      
      // If we received a status event, this is a normal closure
      if (hasReceivedStatusEvent) {
        console.log("Stream completed normally after receiving status event");
        streamCompletedNormally = true;
        eventSource.close();
        onCompleteCallback();
        return;
      }
      
      // If the connection is closed or closing, and we haven't received a status event,
      // check if it's a real error or just a normal close
      if (eventSource.readyState === EventSource.CLOSED) {
        // Connection is closed - if we haven't received a status event, it might be an error
        // But wait a bit to see if status event arrives (race condition)
        setTimeout(() => {
          if (!hasReceivedStatusEvent && !streamCompletedNormally) {
            console.error("SSE connection closed without status event - treating as error");
            streamCompletedNormally = true;
            onErrorCallback(new Error("Connection closed unexpectedly"));
          }
        }, 500);
      } else if (eventSource.readyState === EventSource.CONNECTING) {
        // Still connecting - not an error yet
        console.log("SSE still connecting...");
      } else {
        // OPEN state but error fired - might be a real error
        console.log("SSE in OPEN state with error event - monitoring...");
      }
    };
    
    return eventSource;
  }

  // Execute code on demand (like an online IDE)
  static async executeCode(code, filePath = null, fixErrors = false, originalQuery = null) {
    try {
      const response = await fetch(`${BASE_URL}/data-analysis/execute-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          code, 
          file_path: filePath,
          fix_errors: fixErrors,
          original_query: originalQuery
        })
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error (${response.status}): ${errorText || 'Network response was not ok'}`);
      }
      return response.json();
    } catch (error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`);
      }
      throw error;
    }
  }

  // Editable Workflow API methods (Lesson 6 - Sentence-Level Editing)
  static async createEditableWorkflow(human_request) {
    try {
      const response = await fetch(`${BASE_URL}/editable/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ human_request })
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error (${response.status}): ${errorText || 'Network response was not ok'}`);
      }
      return response.json();
    } catch (error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`);
      }
      throw error;
    }
  }

  static async getSentences(thread_id) {
    try {
      const response = await fetch(`${BASE_URL}/editable/sentences/${thread_id}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error (${response.status}): ${errorText || 'Network response was not ok'}`);
      }
      return response.json();
    } catch (error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`);
      }
      throw error;
    }
  }

  static async editSentence(thread_id, sentence_id, edited_text) {
    try {
      const response = await fetch(`${BASE_URL}/editable/edit-sentence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id, sentence_id, edited_text })
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error (${response.status}): ${errorText || 'Network response was not ok'}`);
      }
      return response.json();
    } catch (error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`);
      }
      throw error;
    }
  }

  static async feedbackSentence(thread_id, sentence_id, feedback) {
    try {
      const response = await fetch(`${BASE_URL}/editable/feedback-sentence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id, sentence_id, feedback })
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error (${response.status}): ${errorText || 'Network response was not ok'}`);
      }
      return response.json();
    } catch (error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`);
      }
      throw error;
    }
  }

  static async resumeEditableWorkflow({ thread_id, review_action, edited_sentences, sentence_feedback, human_comment }) {
    try {
      const body = { thread_id, review_action };
      if (edited_sentences) body.edited_sentences = edited_sentences;
      if (sentence_feedback) body.sentence_feedback = sentence_feedback;
      if (human_comment) body.human_comment = human_comment;
      const response = await fetch(`${BASE_URL}/editable/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error (${response.status}): ${errorText || 'Network response was not ok'}`);
      }
      return response.json();
    } catch (error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`);
      }
      throw error;
    }
  }

  static streamEditableWorkflow(thread_id, onMessageCallback, onErrorCallback, onCompleteCallback) {
    // Create a new EventSource connection to the editable workflow streaming endpoint
    let eventSource;
    let streamCompletedNormally = false;
    let hasReceivedStatusEvent = false;
    
    try {
      eventSource = new EventSource(`${BASE_URL}/editable/stream/${thread_id}`);
    } catch (error) {
      onErrorCallback(new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`));
      return null;
    }
    
    // Handle token events (content streaming from various nodes)
    eventSource.addEventListener('token', (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessageCallback({ 
          content: data.content,
          node: data.node
        });
      } catch (error) {
        console.error("Error parsing token event:", error, "Raw data:", event.data);
        onErrorCallback(error);
      }
    });
    
    // Handle status events (editing, finished)
    eventSource.addEventListener('status', (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessageCallback({ 
          status: data.status,
          current_content: data.current_content,
          sentences: data.sentences,
          revision_count: data.revision_count,
          final_output: data.final_output
        });
        
        hasReceivedStatusEvent = true;
        console.log("Received status event, marking connection for normal closure");
        
        setTimeout(() => {
          if (!streamCompletedNormally) {
            streamCompletedNormally = true;
            eventSource.close();
            onCompleteCallback();
          }
        }, 100);
      } catch (error) {
        console.error("Error parsing status event:", error, "Raw data:", event.data);
        onErrorCallback(error);
      }
    });
    
    // Handle start/resume events
    eventSource.addEventListener('start', (event) => {
      console.log("Editable workflow stream started:", event.data);
    });
    
    eventSource.addEventListener('resume', (event) => {
      console.log("Editable workflow stream resumed:", event.data);
    });
    
    // Handle error events from the backend
    eventSource.addEventListener('error', (event) => {
      try {
        // Check if event.data exists and is not undefined
        if (event.data && event.data !== 'undefined') {
          const data = JSON.parse(event.data);
          const errorMessage = data.error || "Unknown error occurred";
          console.error("Backend error event:", errorMessage);
          streamCompletedNormally = true;
          eventSource.close();
          onErrorCallback(new Error(errorMessage));
        } else {
          // If event.data is undefined or empty, it might be a connection error
          // Don't treat it as an error if we've already received a status event
          if (!hasReceivedStatusEvent) {
            console.log("Error event with no data - likely connection issue");
          }
        }
      } catch (error) {
        // Only log and callback if we have actual error data
        if (event.data && event.data !== 'undefined') {
          console.error("Error parsing error event:", error, "Raw data:", event.data);
          streamCompletedNormally = true;
          eventSource.close();
          onErrorCallback(new Error(event.data || "Unknown error occurred"));
        }
      }
    });
    
    // Handle connection errors
    eventSource.onerror = (error) => {
      if (streamCompletedNormally) {
        return;
      }
      
      console.log("SSE connection state change - readyState:", eventSource.readyState);
      
      if (hasReceivedStatusEvent) {
        console.log("Stream completed normally after receiving status event");
        streamCompletedNormally = true;
        eventSource.close();
        onCompleteCallback();
        return;
      }
      
      if (eventSource.readyState === EventSource.CLOSED) {
        setTimeout(() => {
          if (!hasReceivedStatusEvent && !streamCompletedNormally) {
            console.error("SSE connection closed without status event - treating as error");
            streamCompletedNormally = true;
            onErrorCallback(new Error("Connection closed unexpectedly"));
          }
        }, 500);
      } else if (eventSource.readyState === EventSource.CONNECTING) {
        console.log("SSE still connecting...");
      } else {
        console.log("SSE in OPEN state with error event - monitoring...");
      }
    };
    
    return eventSource;
  }

  // Unified Workflow API methods (Combines all lessons)
  static async startUnifiedWorkflow(workflow_type, user_query, file_path = null, file_name = null) {
    try {
      const body = { workflow_type, user_query };
      if (file_path) body.file_path = file_path;
      if (file_name) body.file_name = file_name;
      const response = await fetch(`${BASE_URL}/unified/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error (${response.status}): ${errorText || 'Network response was not ok'}`);
      }
      return response.json();
    } catch (error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`);
      }
      throw error;
    }
  }

  static async resumeUnifiedWorkflow({ thread_id, workflow_type, action, human_comment, edited_sentences, sentence_feedback }) {
    try {
      const body = { thread_id, workflow_type, action };
      if (human_comment) body.human_comment = human_comment;
      if (edited_sentences) body.edited_sentences = edited_sentences;
      if (sentence_feedback) body.sentence_feedback = sentence_feedback;
      const response = await fetch(`${BASE_URL}/unified/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error (${response.status}): ${errorText || 'Network response was not ok'}`);
      }
      return response.json();
    } catch (error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`);
      }
      throw error;
    }
  }

  static async uploadFile(file) {
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`${BASE_URL}/unified/upload`, {
        method: "POST",
        body: formData
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error (${response.status}): ${errorText || 'Network response was not ok'}`);
      }
      return response.json();
    } catch (error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`);
      }
      throw error;
    }
  }

  static async interruptWorkflow(thread_id, message) {
    try {
      const formData = new FormData();
      formData.append('thread_id', thread_id);
      formData.append('message', message);
      const response = await fetch(`${BASE_URL}/unified/interrupt`, {
        method: "POST",
        body: formData
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error (${response.status}): ${errorText || 'Network response was not ok'}`);
      }
      return response.json();
    } catch (error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`);
      }
      throw error;
    }
  }

  static async getUnifiedSentences(thread_id) {
    try {
      const response = await fetch(`${BASE_URL}/unified/sentences/${thread_id}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error (${response.status}): ${errorText || 'Network response was not ok'}`);
      }
      return response.json();
    } catch (error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`);
      }
      throw error;
    }
  }

  static streamUnifiedWorkflow(thread_id, onMessageCallback, onErrorCallback, onCompleteCallback) {
    // Create a new EventSource connection to the unified workflow streaming endpoint
    let eventSource;
    let streamCompletedNormally = false;
    let hasReceivedStatusEvent = false;
    
    try {
      eventSource = new EventSource(`${BASE_URL}/unified/stream/${thread_id}`);
    } catch (error) {
      onErrorCallback(new Error(`Cannot connect to backend at ${BASE_URL}. Make sure the backend server is running.`));
      return null;
    }
    
    // Handle token events (content streaming from any node)
    eventSource.addEventListener('token', (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessageCallback({ 
          content: data.content,
          node: data.node,
          workflow_type: data.workflow_type
        });
      } catch (error) {
        console.error("Error parsing token event:", error, "Raw data:", event.data);
        onErrorCallback(error);
      }
    });
    
    // Handle status events (user_feedback, finished, editing, code_review)
    eventSource.addEventListener('status', (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessageCallback({ 
          status: data.status,
          workflow_type: data.workflow_type,
          assistant_response: data.assistant_response,
          draft_content: data.draft_content,
          final_output: data.final_output,
          code: data.code,
          visualization_path: data.visualization_path,
          visualization_paths: data.visualization_paths,
          analysis_plan: data.analysis_plan,
          current_content: data.current_content,
          sentences: data.sentences,
          revision_count: data.revision_count,
          current_stage: data.current_stage
        });
        
        hasReceivedStatusEvent = true;
        console.log("Received status event, marking connection for normal closure");
        
        setTimeout(() => {
          if (!streamCompletedNormally) {
            streamCompletedNormally = true;
            eventSource.close();
            onCompleteCallback();
          }
        }, 100);
      } catch (error) {
        console.error("Error parsing status event:", error, "Raw data:", event.data);
        onErrorCallback(error);
      }
    });
    
    // Handle start/resume events
    eventSource.addEventListener('start', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("Unified workflow stream started:", data);
        onMessageCallback({ event: 'start', thread_id: data.thread_id, workflow_type: data.workflow_type });
      } catch (error) {
        console.log("Unified workflow stream started:", event.data);
      }
    });
    
    eventSource.addEventListener('resume', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("Unified workflow stream resumed:", data);
        onMessageCallback({ event: 'resume', thread_id: data.thread_id, workflow_type: data.workflow_type });
      } catch (error) {
        console.log("Unified workflow stream resumed:", event.data);
      }
    });
    
    // Handle error events from the backend
    eventSource.addEventListener('error', (event) => {
      try {
        if (event.data && event.data !== 'undefined') {
          const data = JSON.parse(event.data);
          const errorMessage = data.error || "Unknown error occurred";
          console.error("Backend error event:", errorMessage);
          streamCompletedNormally = true;
          eventSource.close();
          onErrorCallback(new Error(errorMessage));
        }
      } catch (error) {
        if (event.data && event.data !== 'undefined') {
          console.error("Error parsing error event:", error, "Raw data:", event.data);
          streamCompletedNormally = true;
          eventSource.close();
          onErrorCallback(new Error(event.data || "Unknown error occurred"));
        }
      }
    });
    
    // Handle connection errors
    eventSource.onerror = (error) => {
      if (streamCompletedNormally) {
        return;
      }
      
      console.log("SSE connection state change - readyState:", eventSource.readyState);
      
      if (hasReceivedStatusEvent) {
        console.log("Stream completed normally after receiving status event");
        streamCompletedNormally = true;
        eventSource.close();
        onCompleteCallback();
        return;
      }
      
      if (eventSource.readyState === EventSource.CLOSED) {
        setTimeout(() => {
          if (!hasReceivedStatusEvent && !streamCompletedNormally) {
            console.error("SSE connection closed without status event - treating as error");
            streamCompletedNormally = true;
            onErrorCallback(new Error("Connection closed unexpectedly"));
          }
        }, 500);
      } else if (eventSource.readyState === EventSource.CONNECTING) {
        console.log("SSE still connecting...");
      } else {
        console.log("SSE in OPEN state with error event - monitoring...");
      }
    };
    
    return eventSource;
  }
}
