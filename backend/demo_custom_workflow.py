#!/usr/bin/env python3
"""
Demo script for the Custom Gen AI Workflow (Lesson 4)
This script demonstrates how to use the custom workflow API endpoints.

Usage:
    python demo_custom_workflow.py
"""

import requests
import json
import time
import sys

BASE_URL = "http://localhost:8000"


def print_section(title):
    """Print a formatted section header"""
    print("\n" + "=" * 60)
    print(f"  {title}")
    print("=" * 60)


def start_workflow(query):
    """Start a new custom workflow"""
    print_section("Starting Custom Workflow")
    print(f"Query: {query}")
    
    response = requests.post(
        f"{BASE_URL}/custom/start",
        json={"human_request": query},
        headers={"Content-Type": "application/json"}
    )
    
    if response.status_code != 200:
        print(f"Error: {response.status_code} - {response.text}")
        return None
    
    data = response.json()
    thread_id = data["thread_id"]
    print(f"✓ Workflow started")
    print(f"Thread ID: {thread_id}")
    return thread_id


def stream_workflow(thread_id):
    """Stream the workflow execution"""
    print_section("Streaming Workflow Execution")
    
    url = f"{BASE_URL}/custom/stream/{thread_id}"
    print(f"Connecting to: {url}")
    print("Streaming content (this may take a moment)...\n")
    
    current_node = None
    content_buffer = {}
    
    try:
        response = requests.get(url, stream=True, timeout=60)
        
        if response.status_code != 200:
            print(f"Error: {response.status_code} - {response.text}")
            return None
        
        for line in response.iter_lines():
            if line:
                line_str = line.decode('utf-8')
                
                # Parse SSE format: "event: <event_type>\ndata: <json_data>"
                if line_str.startswith("event:"):
                    event_type = line_str.split(":", 1)[1].strip()
                elif line_str.startswith("data:"):
                    data_str = line_str.split(":", 1)[1].strip()
                    try:
                        data = json.loads(data_str)
                        
                        if event_type == "token":
                            node = data.get("node", "unknown")
                            content = data.get("content", "")
                            
                            if node != current_node:
                                if current_node:
                                    print(f"\n[End of {current_node} stage]\n")
                                current_node = node
                                print(f"[{node.upper()} STAGE]")
                                print("-" * 40)
                            
                            # Accumulate content by node
                            if node not in content_buffer:
                                content_buffer[node] = ""
                            content_buffer[node] += content
                            print(content, end="", flush=True)
                        
                        elif event_type == "status":
                            status = data.get("status")
                            print("\n")
                            if status == "user_feedback":
                                print_section("Waiting for Human Review")
                                draft = data.get("draft_content", "")
                                if draft:
                                    print("Draft content preview:")
                                    print(draft[:200] + "..." if len(draft) > 200 else draft)
                                return "user_feedback"
                            elif status == "finished":
                                print_section("Workflow Completed")
                                final = data.get("final_output", "")
                                if final:
                                    print("Final output preview:")
                                    print(final[:200] + "..." if len(final) > 200 else final)
                                return "finished"
                        
                        elif event_type in ["start", "resume"]:
                            print(f"Workflow {event_type}ed")
                    
                    except json.JSONDecodeError:
                        pass
        
        if current_node:
            print(f"\n[End of {current_node} stage]\n")
        
        return "finished"
    
    except requests.exceptions.RequestException as e:
        print(f"Error streaming: {e}")
        return None


def provide_feedback(thread_id, feedback_text=None, approve=False):
    """Provide feedback or approve the workflow"""
    print_section("Providing Human Feedback" if not approve else "Approving Workflow")
    
    if approve:
        review_action = "approved"
        human_comment = None
        print("Action: Approving the draft")
    else:
        review_action = "feedback"
        human_comment = feedback_text or "Please revise and improve the content."
        print(f"Action: Providing feedback")
        print(f"Feedback: {human_comment}")
    
    response = requests.post(
        f"{BASE_URL}/custom/resume",
        json={
            "thread_id": thread_id,
            "review_action": review_action,
            "human_comment": human_comment
        },
        headers={"Content-Type": "application/json"}
    )
    
    if response.status_code != 200:
        print(f"Error: {response.status_code} - {response.text}")
        return False
    
    print("✓ Feedback submitted")
    return True


def main():
    """Main demo function"""
    print("\n" + "=" * 60)
    print("  Custom Gen AI Workflow Demo (Lesson 4)")
    print("=" * 60)
    print("\nThis demo shows a multi-stage Gen AI workflow:")
    print("  1. Research stage - AI gathers information")
    print("  2. Draft stage - AI creates content")
    print("  3. Human review - Workflow pauses for feedback (HITL)")
    print("  4. Finalize stage - AI polishes approved content")
    
    # Get user query
    print("\n" + "-" * 60)
    query = input("Enter your query (or press Enter for default): ").strip()
    if not query:
        query = "Write a blog post about the benefits of renewable energy"
        print(f"Using default query: {query}")
    
    # Step 1: Start workflow
    thread_id = start_workflow(query)
    if not thread_id:
        print("Failed to start workflow")
        sys.exit(1)
    
    time.sleep(1)  # Brief pause
    
    # Step 2: Stream initial execution (research + draft)
    status = stream_workflow(thread_id)
    
    if status == "user_feedback":
        # Step 3: Provide feedback
        print("\n" + "-" * 60)
        choice = input("\nChoose an action:\n1. Provide feedback\n2. Approve\nEnter choice (1 or 2): ").strip()
        
        if choice == "2":
            provide_feedback(thread_id, approve=True)
        else:
            feedback = input("Enter your feedback: ").strip()
            if not feedback:
                feedback = "Make it more technical and add statistics"
                print(f"Using default feedback: {feedback}")
            provide_feedback(thread_id, feedback_text=feedback)
        
        time.sleep(1)
        
        # Step 4: Stream revised/finalized content
        final_status = stream_workflow(thread_id)
        
        if final_status == "user_feedback":
            # If still waiting for feedback, approve it
            print("\nApproving the revised draft...")
            provide_feedback(thread_id, approve=True)
            time.sleep(1)
            stream_workflow(thread_id)
    
    print("\n" + "=" * 60)
    print("  Demo Complete!")
    print("=" * 60)
    print(f"\nThread ID: {thread_id}")
    print("You can use this thread_id to resume the workflow via API.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nDemo interrupted by user")
        sys.exit(0)
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

