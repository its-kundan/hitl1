"""
Feedback Manager - Core logic for feedback handling and LLM integration
Adapted for FastAPI (removed Streamlit dependencies)
"""

import json
from typing import List, Dict, Optional, Any
from datetime import datetime
import uuid
import os


def format_feedbacks_for_llm(feedbacks: List[Dict[str, Any]], general_feedback: Optional[str] = None) -> str:
    """
    Format feedbacks into a structured prompt for LLM.
    Supports both old format (flat list) and new format (grouped by selected_text).
    """
    feedback_parts = []
    
    if general_feedback:
        feedback_parts.append(f"General Feedback: {general_feedback}\n")
    
    if feedbacks:
        # Check if new format (grouped by selected_text)
        if feedbacks and isinstance(feedbacks[0], dict) and 'feedbacks' in feedbacks[0]:
            # New format
            feedback_parts.append("Sentence-Level Feedback (grouped by selected text):")
            for i, item in enumerate(feedbacks, 1):
                selected_text = item.get('selected_text', '')
                feedbacks_list = item.get('feedbacks', [])
                if feedbacks_list:
                    feedback_parts.append(f"\n{i}. Selected Text: \"{selected_text}\"")
                    for j, fb in enumerate(feedbacks_list, 1):
                        feedback_text = fb.get('text', '')
                        feedback_parts.append(f"   Feedback #{j}: {feedback_text}")
        else:
            # Old format (flat list)
            feedback_parts.append("Sentence-Level Feedback:")
            for i, fb in enumerate(feedbacks, 1):
                selected_text = fb.get('selected_text', fb.get('text', ''))
                feedback_text = fb.get('feedback_text', fb.get('feedback', ''))
                fb_type = fb.get('feedback_type', 'Other')
                feedback_parts.append(
                    f"{i}. [{fb_type}] Text: \"{selected_text}\"\n   Feedback: {feedback_text}"
                )
    
    return "\n".join(feedback_parts) if feedback_parts else "No specific feedback provided."


def prepare_regeneration_prompt(
    original_text: str,
    feedbacks: List[Dict[str, Any]],
    general_feedback: Optional[str] = None,
    edited_text: Optional[str] = None,
    text_only: bool = True
) -> str:
    """
    Prepare the complete prompt for LLM regeneration with STRICT preservation constraints.
    """
    formatted_feedback = format_feedbacks_for_llm(feedbacks, general_feedback)
    
    # Determine base text
    base_text = edited_text if edited_text else original_text
    
    if text_only:
        prompt = f"""You are an expert report editor.
You are allowed to use visual context implicitly to improve clarity and accuracy.
You MUST NOT reference images, charts, figures, filenames, or visuals explicitly.
You MUST NOT change structure, layout, or formatting.
Visual elements are immutable.

CRITICAL RULES:
- You receive ONLY TEXT content (no HTML, no images, no charts)
- Output ONLY improved text (no HTML tags, no markdown, no image references)
- You may use visual context IMPLICITLY to improve text clarity
- DO NOT mention "the chart shows", "the image displays", "figure X", or any visual references
- DO NOT add structural elements
- Improve ONLY the textual content based on feedback
- Preserve paragraph breaks and text flow

ORIGINAL TEXT CONTENT (text only):
{base_text[:4000]}

FEEDBACK TO ADDRESS:
{formatted_feedback}

OUTPUT REQUIREMENTS:
- Return ONLY improved text content
- No HTML tags
- No markdown syntax
- No explicit image/chart/figure references
- No structural changes
- Preserve paragraph structure with blank lines
- Improve clarity, accuracy, and readability based on feedback
- If no feedback exists for a section, return it unchanged

Return ONLY the improved text, no explanations or commentary."""
    else:
        prompt = f"""You are an expert report editor.
You must improve text ONLY where human feedback is provided.
You MUST preserve structure, formatting, and visuals exactly.

ABSOLUTE RULES:
- DO NOT change images
- DO NOT change charts
- DO NOT change tables
- DO NOT change markdown structure
- DO NOT change headings or order
- DO NOT remove or reformat anything visual
- Improve ONLY text related to feedback

ORIGINAL REPORT:
{base_text[:8000]}

FEEDBACK TO ADDRESS:
{formatted_feedback}

OUTPUT REQUIREMENTS:
- Return FULL report content
- Text improvements only
- Images must remain EXACTLY unchanged
- If no feedback exists for a section, leave it unchanged
- Preserve all markdown image syntax: ![alt](path)
- Preserve all HTML image tags: <img ...>
- Preserve all chart/visualization references

Return ONLY the improved report text, no explanations or commentary."""
    
    return prompt


def regenerate_with_feedback(
    original_text: str,
    feedbacks: List[Dict[str, Any]],
    general_feedback: Optional[str] = None,
    edited_text: Optional[str] = None,
    api_key: Optional[str] = None,
    model: str = "llama-3.3-70b-versatile",
    original_html: Optional[str] = None,
    text_only_mode: bool = True
) -> str:
    """
    Regenerate text using LLM with feedback, preserving images and formatting.
    """
    try:
        from langchain_groq import ChatGroq
        from langchain_core.prompts import ChatPromptTemplate
        
        groq_api_key = api_key or os.getenv('GROQ_API_KEY')
        if not groq_api_key:
            raise ValueError("GROQ_API_KEY not found. Cannot generate improved report.")
        
        llm = ChatGroq(groq_api_key=groq_api_key, model=model, temperature=0.3)
        
        prompt_template = prepare_regeneration_prompt(
            original_text,
            feedbacks,
            general_feedback,
            edited_text if edited_text else None,
            text_only=text_only_mode
        )
        
        prompt = ChatPromptTemplate.from_template(prompt_template)
        response = llm.invoke(prompt.format())
        
        regenerated_text = response.content.strip()
        return regenerated_text
        
    except Exception as e:
        raise Exception(f"Error regenerating report: {str(e)}")
