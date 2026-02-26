# insights.py
from app.state import IntelligentAnalysisState

from typing import TypedDict, List, Dict, Any, Optional, Tuple
import pandas as pd
import json
import numpy as np
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from google import genai
from PIL import Image
from google.genai import types
from pathlib import Path
import warnings
import os

# Suppress warnings that might clutter the output
warnings.filterwarnings('ignore', category=UserWarning)

def setup_gemini():
    """Setup Google Gemini vision model"""
    print(" Checking if Gemini is available...")
    
    try:
        # Client initializes using GEMINI_API_KEY from environment variables
        client = genai.Client()
        print(" Gemini client initialized successfully!")
        # IMPORTANT: Use gemini-2.5-flash for better performance/rate limits than 2.0-flash-exp
        return client, "gemini-2.5-flash" 
    except Exception as e:
        print(f" Error initializing Gemini: {e}")
        print("Ensure your GEMINI_API_KEY is set correctly.")
        return None, None

class EnhancedInsightGenerator:
    """Enhanced insight generator with Google Gemini Vision"""
    
    def __init__(self, groq_api_key: str):
        self.llm = ChatGroq(groq_api_key=groq_api_key, model="llama-3.3-70b-versatile", temperature=0.1)
        self.gemini_client, self.gemini_model = setup_gemini()
        self.vlm_available = self.gemini_client is not None
    
    
    def _get_all_chart_paths(self, state: 'IntelligentAnalysisState') -> List[str]:
        """
        Gathers all chart file paths from state['chart_paths'] and charts directory.
        """
        
        # Initialize a set to automatically handle unique paths
        unique_chart_paths = set()
        
        # 1. Use chart paths from state if available
        if state.get('chart_paths'):
            for path in state['chart_paths']:
                if os.path.exists(path):
                    unique_chart_paths.add(str(Path(path).resolve()))
        
        # 2. Search in charts directory (relative to backend working directory)
        charts_dir = Path('charts')
        if charts_dir.is_dir():
            for ext in ('*.png', '*.jpg', '*.jpeg', '*.PNG', '*.JPG', '*.JPEG'):
                for file_path in charts_dir.glob(ext):
                    unique_chart_paths.add(str(file_path.resolve()))
        
        # Convert the set back to a list, ensuring all paths exist
        final_paths = [p for p in list(unique_chart_paths) if os.path.exists(p)]
        
        print(f" Found a total of {len(final_paths)} unique charts.")
        return final_paths


    def generate_comprehensive_insights(self, state: 'IntelligentAnalysisState') -> List[str]:
        """
        Generate insights with Gemini Vision, labeling each insight source.
        """
        insights = []
        
        try:
            # 1. Analyze specialized results (Text-based, LLM - Groq Llama)
            if state['specialized_analyses']:
                print("Running Specialized (Llama/Groq) Analysis...")
                
                # Call the Llama analysis, which now returns a single string
                specialized_insights_content = self._analyze_specialized_results(state)
                
                #  NEW: Label and append the single Llama insight string
                if specialized_insights_content and isinstance(specialized_insights_content, str):
                    # Prepend the LLAMA label for the final report
                    insights.append(f"[LLAMA INSIGHTS]\n{specialized_insights_content}")
            
            # 2. Analyze charts holistically with Gemini Vision (VLM)
            if self.vlm_available:
                all_charts_to_analyze = self._get_all_chart_paths(state)
                
                if all_charts_to_analyze:
                    print(f"Running Holistic VLM Analysis on {len(all_charts_to_analyze)} charts...")
                    
                    # Call the Gemini analysis, which now returns a single string
                    visual_insights_content = self._analyze_charts_holistically_with_gemini(state, all_charts_to_analyze) 
                    
                    #  NEW: Label and append the single Gemini insight string
                    if visual_insights_content and isinstance(visual_insights_content, str):
                        # Prepend the GEMINI label for the final report
                        insights.append(f"[GEMINI INSIGHTS]\n{visual_insights_content}")
            
        except Exception as e:
            # This is the last resort catch block for fatal, unexpected errors
            print(f" An unexpected FATAL error occurred: {str(e)}")
            insights.append(f"[FATAL ERROR]\nAn unexpected error occurred: {str(e)}")
        
        return insights
    
    
    def _analyze_charts_holistically_with_gemini(self, state: 'IntelligentAnalysisState', chart_paths_consolidated: List[str]) -> str:
        """
        Use Google Gemini to analyze ALL charts simultaneously and generate a single, 
        comprehensive business intelligence report. Returns a single string report.
        """
        if not self.gemini_client:
            return " Gemini VLM not available for holistic chart analysis."
        
        dataset_name = state['dataset_info'].get('name', 'Business Dataset')
        dataset_shape = state['dataset'].shape
        
        # --- 1. Prepare Content for VLM ---
        content_parts = []
        chart_names = []
        
        for chart_path in chart_paths_consolidated: 
            path = Path(chart_path)
            try:
                img = Image.open(chart_path)
                content_parts.append(img)
                chart_names.append(path.name) # Store the exact filename
            except Exception as e:
                print(f" Error loading image {chart_path} (Skipping): {e}")
                continue
        
        if not content_parts:
            return " No readable charts were found for holistic VLM analysis."

        print(f" Sending {len(content_parts)} charts to Gemini VLM for holistic report generation...")
        
        # --- 2. Construct the Comprehensive Prompt ---
        
        #  Ensure the list is correctly formatted for Gemini
        chart_list_for_prompt = "\n".join([f"- **{name}**" for name in chart_names])
        
        holistic_prompt = f"""
You are a **Senior Business Analyst and Strategy Consultant**. Your task is to analyze the 
{len(content_parts)} provided charts holistically, treating them as a complete business intelligence dashboard 
for the **{dataset_name}** ({dataset_shape[0]:,} records).

You must provide an analysis that synthesizes information across all visuals and strictly adheres to the 
REQUIRED OUTPUT FORMAT below.

###  Reference File List (CRITICAL: COPY THESE NAMES EXACTLY)
This is the list of **{len(chart_names)}** chart filenames you must use for the **Chart Catalog (Section 0)**.
{chart_list_for_prompt}

###  EXECUTIVE SUMMARY REPORT (REQUIRED OUTPUT FORMAT)

#### 0. Chart Catalog
**CRITICAL INSTRUCTION**: **USE THE FILENAMES FROM THE 'Reference File List' ABOVE**. Generate a complete list of ALL {len(chart_names)} charts. Use this exact format for every item: **[Index]. [EXACT FILENAME]: [2-sentence description of purpose and data representation].** **DO NOT include the text 'VLM Findings' anywhere in the numbered list items.** **DO NOT STOP GENERATION UNTIL THE LIST IS COMPLETE.**

1. **{chart_names[0] if chart_names else '[First Filename]'}**: [Description 1 (Start the description immediately after the colon)].
2. **{chart_names[1] if len(chart_names) > 1 else '[Second Filename]'}**: [Description 2 (Start the description immediately after the colon)].
NOTE: the charts description should be more of a business oriented like this graph shows more profits of this specific product in this year etc. Should be more of a business insight oriented. ESPECIALLY for the charts bar_Plots.png, Bar_Plot_Cat.png,Dist_Plots_Numeric.png i dont need the image description but the graph insights like it shows growth profit, this category is high etc.
... (Continue this pattern for all {len(chart_names)} files)
NOTE: give those charts insights like a business insights pov... like analysis.
#### 1. Overall Performance Summary
(A one-paragraph assessment of the overall health based on Sales, Profit, and key trends.)

#### 2. Key Insights & Drivers (Synthesized across charts)
* **[Sales Driver]:** Identify the top geographic/segment/category driver and quantify its impact.
* **[Profit/Margin Risk]:** Identify a major area of low margin or high loss and quantify the risk (e.g., losses in Texas).
* **[Strategic Trend]:** Describe the most important time-series trend (e.g., quarterly growth, seasonality).

#### 3. Data-Driven Recommendations (NOTE: should be very detailed and business insighted which can help to make profits or etc etc u can mention graphs if u want and also u can mention where to concentrate in which category etc and even to cover up the losses).
Provide 3 concrete, strategic actions based on the combined evidence:
1. [Action 1] to address [Insight].
2. [Action 2] for [Segment/Category] optimization.
3. [Action 3] to mitigate [Risk/Anomaly].


"""
        # --- 3. Execute VLM Call ---
        try:
            content_parts.insert(0, holistic_prompt)
            config = types.GenerateContentConfig(max_output_tokens=6000, temperature=0.4)
            
            response = self.gemini_client.models.generate_content(
                model=self.gemini_model,
                contents=content_parts,
                config=config
            )
            
            if response and response.text:
                return response.text.strip() # Returns the full report string
            else:
                return " VLM returned an empty response for the holistic analysis."
                
        except Exception as e:
            print(f" Error during holistic VLM analysis: {e}")
            return f" FATAL VLM ANALYSIS ERROR: {str(e)}"
    
    
    def _analyze_specialized_results(self, state: 'IntelligentAnalysisState') -> str:
        """
        Analyze specialized results with Groq Llama 3.3. Returns a single string.
        """
        
        summarized_results = {}
        for key, result in state['specialized_analyses'].items():
            if 'error' not in result:
                safe_result = self._make_json_safe(self._summarize_for_llm(result, max_items=10))
                summarized_results[str(key)] = safe_result 
        
        if not summarized_results:
            return "No specialized analysis results to analyze."
        
        specialized_prompt = ChatPromptTemplate.from_template("""
        Analyze these business analysis results and provide key insights:
        
        {analysis_results}
        
        You are a **Senior Business Analyst and Strategy Consultant**.
        
        Provide the analysis in a bulleted list, focusing on the most important, quantified findings.
        """)
        
        try:
            response = self.llm.invoke(specialized_prompt.format(
                analysis_results=json.dumps(summarized_results, indent=2)
            ))
            
            # Use bullet points for parsing
            insights_list = [insight.strip() for insight in response.content.split('•') if insight.strip()]

            #  NEW: Format and join into a single, clean string with bullet points
            formatted_insights = "--- Specialized Analysis Results (LLAMA 3.3) ---\n" + \
                                 "\n".join([f"• {i}" for i in insights_list])
            
            return formatted_insights
            
        except Exception as e:
            print(f" Error during Llama/Groq specialized analysis: {e}")
            return f" Error analyzing specialized results: {str(e)}"
    
    
    # --- Utility functions remain unchanged ---

    def _make_json_safe(self, obj):
        """Convert dict keys and values to JSON-safe types, stringify Timestamps/Periods."""
        if isinstance(obj, dict):
            return {str(k): self._make_json_safe(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [self._make_json_safe(v) for v in obj]
        elif isinstance(obj, (pd.Timestamp, pd.Period)):
            return str(obj)
        else:
            return obj
    
    def _summarize_for_llm(self, data, max_items=10):
        """Recursive summarization for nested data structures"""
        if isinstance(data, dict):
            if len(data) > max_items:
                items = list(data.items())[:max_items]
                summary = dict(items)
                summary['_summary'] = f"... {len(data) - max_items} more items truncated"
                return summary
            return {k: self._summarize_for_llm(v, max_items) for k, v in data.items()}
        elif isinstance(data, list):
            if len(data) > max_items:
                return [self._summarize_for_llm(item, max_items) for item in data[:max_items]] + [f"... {len(data) - max_items} more items"]
            return [self._summarize_for_llm(item, max_items) for item in data]
        return data

# insights.py - Standalone function for generating insights using Gemini (including images)

def generate_insights_from_report(gemini_client, gemini_model, user_query, report_content, image_paths=[]):
    """
    This function generates insights using Gemini for both text (report content) and images (charts).
    It takes a user query and generates insights based on both the report text and the provided images.
    """
    # Prepare the text-based prompt for Gemini
    text_prompt = f"""
    Based on the following report content, provide insights for the user query.

    **Report Content:**
    {report_content}

    **User Query:**
    {user_query}

    Provide the insights in a structured format, focusing on business trends, key findings, and recommendations.
    """

    # Combine text and images for Gemini VLM processing
    contents = [text_prompt]  # Text prompt first
    
    # Add images for VLM processing (send them to Gemini)
    images = []
    for image_path in image_paths:
        try:
            img = Image.open(image_path)
            images.append(img)
        except Exception as e:
            print(f"Error loading image {image_path}: {e}")
    
    # Use Gemini VLM to process both text and images
    if images:
        print(f"Sending {len(images)} images to Gemini VLM for analysis...")
        try:
            # Call Gemini's VLM to analyze both text and images
            response = gemini_client.models.generate_content(
                model=gemini_model,
                contents=contents + images,  # Include the images with the text prompt
                config=types.GenerateContentConfig(max_output_tokens=1000, temperature=0.4)
            )
            insight = response.text.strip() if response and response.text else "No insights generated."
            return insight
        except Exception as e:
            return f"Error generating insights with VLM: {str(e)}"

    # Fallback if no images provided, just generate insights based on text content
    else:
        # Call Gemini's model for text insights only
        response = gemini_client.models.generate_content(
            model=gemini_model,
            contents=contents,
            config=types.GenerateContentConfig(max_output_tokens=1000, temperature=0.4)
        )
        insight = response.text.strip() if response and response.text else "No insights generated."
        return insight
