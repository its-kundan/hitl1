# hitl_analysis_workflow.py
# Human-In-The-Loop (HITL) Iterative Data Analysis Workflow

from typing import TypedDict, List, Dict, Any, Optional, Literal
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
import pandas as pd
import json
import os
from datetime import datetime
from pathlib import Path

from app.planner import IntelligentAnalysisPlanner
from app.executor import IntelligentAnalysisExecutor
from app.visualizer import ComprehensiveVisualizationGenerator
from app.insights import EnhancedInsightGenerator

# =============================================================================
# HITL WORKFLOW STATE DEFINITION
# =============================================================================

class HITLAnalysisWorkflowState(TypedDict):
    """State for HITL iterative analysis workflow"""
    # Core data
    user_query: str
    file_path: str
    dataset: Optional[pd.DataFrame]
    data_profile: Optional[Dict[str, Any]]
    
    # Planning
    plan: List[str]  # List of analysis step titles/sections
    plan_details: Optional[Dict[str, Any]]  # Full plan with details
    
    # Section generation
    current_section_index: int
    generated_sections: List[Dict[str, Any]]  # Each section: {section_title, content, analysis_type, analysis_results, visualizations, insights, raw_data}
    
    # Human feedback
    human_feedback: Optional[str]  # General feedback text
    edited_content: Optional[str]  # Direct text edits
    sentence_feedback: Optional[List[Dict[str, str]]]  # List of {text, feedback} pairs
    approval_status: Literal["pending", "approved", "feedback"]
    
    # Final output
    final_output: Optional[str]
    final_output_original: Optional[str]  # Store original for comparison
    
    # Metadata
    current_step: str
    error_log: List[str]


# =============================================================================
# HITL WORKFLOW NODES
# =============================================================================

class HITLAnalysisWorkflow:
    """Human-In-The-Loop iterative analysis workflow"""
    
    def __init__(self, groq_api_key: str):
        self.groq_api_key = groq_api_key
        self.planner = IntelligentAnalysisPlanner(groq_api_key)
        self.insight_generator = EnhancedInsightGenerator(groq_api_key)
    
    def data_profiling_node(self, state: HITLAnalysisWorkflowState) -> HITLAnalysisWorkflowState:
        """Profile the dataset"""
        try:
            if state.get('dataset') is None:
                # Load dataset if not already loaded
                df = pd.read_csv(state['file_path'], encoding="latin1")
                # Convert date columns
                if 'Order Date' in df.columns:
                    df['Order_Date'] = pd.to_datetime(df['Order Date'], dayfirst=True, format='mixed')
                if 'Ship Date' in df.columns:
                    df['Ship_Date'] = pd.to_datetime(df['Ship Date'], dayfirst=True, format='mixed')
                state['dataset'] = df
            
            # Profile dataset using planner's profiling method
            data_profile = self.planner._profile_dataset(state['dataset'])
            state['data_profile'] = data_profile
            state['current_step'] = 'data_profiling_complete'
            
        except Exception as e:
            error_msg = f"Data profiling error: {str(e)}"
            state['error_log'].append(error_msg)
            state['current_step'] = 'error'
        
        return state
    
    def planning_node(self, state: HITLAnalysisWorkflowState) -> HITLAnalysisWorkflowState:
        """Generate analysis plan as a list of section titles"""
        try:
            df = state['dataset']
            dataset_info = {'name': state.get('user_query', 'Dataset'), 'description': state['user_query']}
            
            # Get full plan from planner
            full_plan = self.planner.create_analysis_plan(df, dataset_info)
            state['plan_details'] = full_plan
            
            # Extract section titles from plan
            plan_sections = []
            
            # Add specialized analyses as sections
            for analysis in full_plan.get('specialized_analyses', []):
                function_name = analysis.get('function', 'analysis')
                columns = analysis.get('columns', [])
                title = f"{function_name.replace('_', ' ').title()} - {', '.join(columns[:2])}"
                plan_sections.append(title)
            
            # Add visualizations as sections
            for viz in full_plan.get('visualizations', []):
                chart_type = viz.get('chart_type', 'visualization')
                title = viz.get('title', f"{chart_type.replace('_', ' ').title()}")
                plan_sections.append(title)
            
            # If no sections, create default ones
            if not plan_sections:
                plan_sections = [
                    "Data Overview",
                    "Correlation Analysis",
                    "Time Series Analysis",
                    "Distribution Analysis"
                ]
            
            state['plan'] = plan_sections
            state['current_section_index'] = 0
            state['generated_sections'] = []
            state['current_step'] = 'planning_complete'
            
        except Exception as e:
            error_msg = f"Planning error: {str(e)}"
            state['error_log'].append(error_msg)
            state['current_step'] = 'error'
        
        return state
    
    def generate_section_node(self, state: HITLAnalysisWorkflowState) -> HITLAnalysisWorkflowState:
        """Generate a single analysis section"""
        try:
            current_idx = state['current_section_index']
            plan = state['plan']
            df = state['dataset']
            plan_details = state.get('plan_details', {})
            
            if current_idx >= len(plan):
                state['current_step'] = 'all_sections_complete'
                return state
            
            section_title = plan[current_idx]
            
            # Check if this is a revision (has feedback/edits)
            is_revision = (
                state.get('approval_status') == 'feedback' or
                state.get('human_feedback') or
                state.get('edited_content') or
                state.get('sentence_feedback')
            )
            
            section = {
                'section_title': section_title,
                'content': '',
                'analysis_type': '',
                'analysis_results': {},
                'visualizations': [],
                'insights': '',
                'raw_data': None
            }
            
            # Determine section type from plan
            # Match section title to plan details
            section_type = None
            section_config = None
            
            # Try to match with specialized analyses
            for analysis in plan_details.get('specialized_analyses', []):
                function_name = analysis.get('function', '')
                if function_name.replace('_', ' ').title() in section_title:
                    section_type = 'specialized_analysis'
                    section_config = analysis
                    break
            
            # Try to match with visualizations
            if not section_type:
                for viz in plan_details.get('visualizations', []):
                    viz_title = viz.get('title', '')
                    if viz_title in section_title or section_title in viz_title:
                        section_type = 'visualization'
                        section_config = viz
                        break
            
            # Generate section content
            if is_revision:
                # Incorporate feedback for regeneration
                feedback_text = state.get('human_feedback', '')
                edited_text = state.get('edited_content', '')
                sentence_feedbacks = state.get('sentence_feedback', [])
                
                # Combine all feedback
                combined_feedback = f"User feedback: {feedback_text}\n"
                if edited_text:
                    combined_feedback += f"Edited content: {edited_text}\n"
                if sentence_feedbacks:
                    for sf in sentence_feedbacks:
                        combined_feedback += f"Feedback on '{sf.get('text', '')}': {sf.get('feedback', '')}\n"
                
                # Regenerate with feedback
                section = self._regenerate_section_with_feedback(
                    df, section_title, section_type, section_config, combined_feedback, state
                )
            else:
                # Generate new section
                section = self._generate_new_section(
                    df, section_title, section_type, section_config, state
                )
            
            # Store section (replace if revising current, append if new)
            if is_revision and state.get('generated_sections') and current_idx < len(state['generated_sections']):
                state['generated_sections'][current_idx] = section
            else:
                if len(state['generated_sections']) <= current_idx:
                    state['generated_sections'].extend([None] * (current_idx + 1 - len(state['generated_sections'])))
                state['generated_sections'][current_idx] = section
            
            # Reset feedback fields
            state['human_feedback'] = None
            state['edited_content'] = None
            state['sentence_feedback'] = None
            state['approval_status'] = 'pending'
            state['current_step'] = 'section_generated'
            
        except Exception as e:
            error_msg = f"Section generation error: {str(e)}"
            state['error_log'].append(error_msg)
            state['current_step'] = 'error'
        
        return state
    
    def _generate_new_section(
        self, df: pd.DataFrame, section_title: str, 
        section_type: Optional[str], section_config: Optional[Dict],
        state: HITLAnalysisWorkflowState
    ) -> Dict[str, Any]:
        """Generate a new analysis section"""
        section = {
            'section_title': section_title,
            'content': '',
            'analysis_type': section_type or 'general',
            'analysis_results': {},
            'visualizations': [],
            'insights': '',
            'raw_data': None
        }
        
        try:
            if section_type == 'specialized_analysis' and section_config:
                # Execute specialized analysis
                function_name = section_config.get('function')
                columns = section_config.get('columns', [])
                parameters = section_config.get('parameters', {})
                
                # Execute analysis
                analysis_result = self._execute_single_analysis(df, function_name, columns, parameters)
                section['analysis_results'] = analysis_result
                section['analysis_type'] = function_name
                
                # Generate visualization if applicable
                if analysis_result and 'error' not in analysis_result:
                    viz_paths = self._create_visualization_for_analysis(df, analysis_result, function_name, section_title)
                    section['visualizations'] = viz_paths
                
                # Generate content description
                section['content'] = self._generate_section_content(section_title, analysis_result, None, state)
                
            elif section_type == 'visualization' and section_config:
                # Create visualization
                chart_type = section_config.get('chart_type')
                columns = section_config.get('columns', [])
                title = section_config.get('title', section_title)
                
                viz_paths = self._create_visualization_from_config(df, chart_type, columns, title)
                section['visualizations'] = viz_paths
                section['analysis_type'] = chart_type
                
                # Generate content description
                section['content'] = self._generate_section_content(section_title, None, viz_paths, state)
                
            else:
                # General section - create a simple analysis
                section['content'] = f"## {section_title}\n\nAnalysis of key patterns and trends in the dataset."
                section['analysis_type'] = 'general'
        
        except Exception as e:
            section['content'] = f"Error generating section: {str(e)}"
            section['analysis_results'] = {'error': str(e)}
        
        return section
    
    def _regenerate_section_with_feedback(
        self, df: pd.DataFrame, section_title: str,
        section_type: Optional[str], section_config: Optional[Dict],
        feedback: str, state: HITLAnalysisWorkflowState
    ) -> Dict[str, Any]:
        """Regenerate section incorporating user feedback"""
        # Get original section if exists
        original_section = None
        if state.get('generated_sections') and state['current_section_index'] < len(state['generated_sections']):
            original_section = state['generated_sections'][state['current_section_index']]
        
        # Initialize section structure
        section = {
            'section_title': section_title,
            'content': '',
            'analysis_type': section_type or 'general',
            'analysis_results': {},
            'visualizations': [],
            'insights': '',
            'raw_data': None
        }

        # Decide whether to regenerate analysis or just update text
        # For now, we prioritize preserving the original images/analysis unless explicitly forced
        # This fixes the issue where images got re-generated (and renamed) during feedback
        if original_section:
            section['analysis_results'] = original_section.get('analysis_results', {})
            section['visualizations'] = original_section.get('visualizations', [])
            section['analysis_type'] = original_section.get('analysis_type', '')
            section['raw_data'] = original_section.get('raw_data')
            # Use original content as baseline
            section['content'] = original_section.get('content', '')
        else:
            # Fallback if no original section exists
            return self._generate_new_section(df, section_title, section_type, section_config, state)
        
        # Incorporate feedback into content using LLM
        if feedback and original_section:
            try:
                from langchain_groq import ChatGroq
                from langchain_core.prompts import ChatPromptTemplate
                
                llm = ChatGroq(groq_api_key=self.groq_api_key, model="llama-3.3-70b-versatile", temperature=0.3)
                
                prompt = ChatPromptTemplate.from_template("""
                Original section content:
                {original_content}
                
                User feedback and edits:
                {feedback}
                
                Please regenerate this section incorporating the user's feedback. Maintain the same structure but improve based on the feedback.
                IMPORTANT: Do not remove or change any image/chart references (lines starting with ! or containing image paths).
                """)
                
                response = llm.invoke(prompt.format(
                    original_content=original_section.get('content', ''),
                    feedback=feedback
                ))
                
                section['content'] = response.content.strip()
                
            except Exception as e:
                section['content'] = f"{original_section.get('content', '')}\n\n[Note: Feedback incorporation had an error: {str(e)}]"
        
        return section
    
    def _execute_single_analysis(
        self, df: pd.DataFrame, function_name: str, 
        columns: List[str], parameters: Dict
    ) -> Dict[str, Any]:
        """Execute a single specialized analysis"""
        try:
            from anl_funcs import SpecializedAnalytics
            
            analysis_func = getattr(SpecializedAnalytics, function_name)
            
            if function_name == 'time_series_decomposition':
                if len(columns) >= 2:
                    return analysis_func(df, columns[0], columns[1])
            elif function_name == 'cohort_analysis':
                if len(columns) >= 2:
                    value_col = columns[2] if len(columns) > 2 else None
                    return analysis_func(df, columns[0], columns[1], value_col)
            elif function_name == 'customer_segmentation':
                if len(columns) >= 2:
                    return analysis_func(df, columns[0], columns[1:])
            elif function_name == 'correlation_network_analysis':
                threshold = parameters.get('threshold', 0.5)
                return analysis_func(df, columns, threshold)
            elif function_name == 'anomaly_detection':
                return analysis_func(df, columns)
            elif function_name == 'distribution_comparison':
                if len(columns) >= 2:
                    return analysis_func(df, columns[0], columns[1])
            else:
                return {'error': f'Unknown analysis function: {function_name}'}
                
        except Exception as e:
            return {'error': str(e)}
    
    def _create_visualization_for_analysis(
        self, df: pd.DataFrame, analysis_result: Dict, 
        analysis_type: str, title: str
    ) -> List[Dict[str, Any]]:
        """Create visualization from analysis result"""
        try:
            # Create a temporary plan structure for visualization generator
            temp_plan = {
                'specialized_analyses': [{
                    'function': analysis_type,
                    'columns': [],
                    'parameters': {}
                }]
            }
            
            temp_analysis_results = {f"{analysis_type}_0": analysis_result}
            
            png_paths, html_paths = ComprehensiveVisualizationGenerator.create_intelligent_charts(
                df, temp_plan, temp_analysis_results
            )
            
            visualizations = []
            for i, (png, html) in enumerate(zip(png_paths, html_paths)):
                visualizations.append({
                    'type': analysis_type,
                    'png_path': png,
                    'html_path': html,
                    'title': f"{title} - Visualization {i+1}"
                })
            
            return visualizations
            
        except Exception as e:
            return [{'error': str(e)}]
    
    def _create_visualization_from_config(
        self, df: pd.DataFrame, chart_type: str, 
        columns: List[str], title: str
    ) -> List[Dict[str, Any]]:
        """Create visualization from config"""
        try:
            temp_plan = {
                'visualizations': [{
                    'chart_type': chart_type,
                    'columns': columns,
                    'title': title
                }]
            }
            
            png_paths, html_paths = ComprehensiveVisualizationGenerator.create_intelligent_charts(
                df, temp_plan, {}
            )
            
            visualizations = []
            for i, (png, html) in enumerate(zip(png_paths, html_paths)):
                visualizations.append({
                    'type': chart_type,
                    'png_path': png,
                    'html_path': html,
                    'title': title
                })
            
            return visualizations
            
        except Exception as e:
            return [{'error': str(e)}]
    
    def _generate_section_content(
        self, section_title: str, analysis_results: Optional[Dict],
        visualizations: Optional[List], state: HITLAnalysisWorkflowState
    ) -> str:
        """Generate markdown content for section"""
        content_parts = [f"## {section_title}\n"]
        
        if analysis_results and 'error' not in analysis_results:
            content_parts.append("### Analysis Results\n")
            # Summarize key findings
            if isinstance(analysis_results, dict):
                key_findings = []
                for key, value in list(analysis_results.items())[:5]:  # Limit to 5 key items
                    if not isinstance(value, (dict, list)) or (isinstance(value, (dict, list)) and len(str(value)) < 200):
                        key_findings.append(f"- **{key}**: {value}")
                if key_findings:
                    content_parts.append("\n".join(key_findings))
        
        if visualizations:
            content_parts.append("\n### Visualizations\n")
            for viz in visualizations[:3]:  # Limit to 3 visualizations
                if 'error' not in viz:
                    content_parts.append(f"- {viz.get('title', 'Chart')}")
        
        # Generate insights using LLM
        try:
            from langchain_groq import ChatGroq
            from langchain_core.prompts import ChatPromptTemplate
            
            llm = ChatGroq(groq_api_key=self.groq_api_key, model="llama-3.3-70b-versatile", temperature=0.3)
            
            insight_prompt = ChatPromptTemplate.from_template("""
            Based on the following analysis section, provide 2-3 key insights in bullet points:
            
            Section: {section_title}
            Analysis Results: {analysis_summary}
            
            Provide concise, actionable insights.
            """)
            
            analysis_summary = str(analysis_results)[:500] if analysis_results else "General analysis"
            
            response = llm.invoke(insight_prompt.format(
                section_title=section_title,
                analysis_summary=analysis_summary
            ))
            
            content_parts.append("\n### Key Insights\n")
            content_parts.append(response.content.strip())
            
        except Exception as e:
            content_parts.append(f"\n### Key Insights\n* Analysis completed. (Insight generation had an error: {str(e)})")
        
        return "\n".join(content_parts)
    
    def human_review_node(self, state: HITLAnalysisWorkflowState) -> HITLAnalysisWorkflowState:
        """Pause point for human review (no-op, just marks state)"""
        state['current_step'] = 'awaiting_human_review'
        return state
    
    def _generate_interactive_html_report(self, state: HITLAnalysisWorkflowState) -> str:
        """Generate interactive HTML report from sections and charts"""
        from pathlib import Path
        import base64
        
        sections = state.get('generated_sections', [])
        chart_dir = Path("charts")
        charts_html_dir = Path("charts_html")
        
        # Collect all chart paths
        all_chart_paths = []
        for section in sections:
            if section and section.get('visualizations'):
                for viz in section['visualizations']:
                    if viz.get('png_path'):
                        all_chart_paths.append(viz['png_path'])
                    if viz.get('html_path'):
                        all_chart_paths.append(viz['html_path'])
        
        # Build HTML content
        nav_html = ""
        content_html = ""
        
        for i, section in enumerate(sections):
            if not section:
                continue
                
            section_id = f"section-{i}"
            section_title = section.get('section_title', f'Section {i+1}')
            section_content = section.get('content', '')
            visualizations = section.get('visualizations', [])
            
            # Navigation button
            active_class = "active" if i == 0 else ""
            nav_html += f'<button class="tablinks {active_class}" onclick="openSection(event, \'{section_id}\')">{section_title}</button>\n'
            
            # Content tab
            display_style = 'display: block;' if i == 0 else 'display: none;'
            content_html += f'<div id="{section_id}" class="tabcontent" style="{display_style}">\n'
            content_html += f'<h2>{section_title}</h2>\n'
            
            # Convert markdown to HTML
            import re
            section_html = section_content
            # Headers
            section_html = re.sub(r'^### (.+)$', r'<h3>\1</h3>', section_html, flags=re.MULTILINE)
            section_html = re.sub(r'^## (.+)$', r'<h2>\1</h2>', section_html, flags=re.MULTILINE)
            section_html = re.sub(r'^# (.+)$', r'<h1>\1</h1>', section_html, flags=re.MULTILINE)
            # Bold
            section_html = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', section_html)
            # Italic
            section_html = re.sub(r'\*(.+?)\*', r'<em>\1</em>', section_html)
            # Code blocks
            section_html = re.sub(r'```(\w+)?\n(.*?)```', r'<pre><code>\2</code></pre>', section_html, flags=re.DOTALL)
            # Inline code
            section_html = re.sub(r'`(.+?)`', r'<code>\1</code>', section_html)
            # Lists
            lines = section_html.split('\n')
            processed_lines = []
            in_list = False
            for line in lines:
                if re.match(r'^\s*[-*+]\s+', line):
                    if not in_list:
                        processed_lines.append('<ul>')
                        in_list = True
                    item = re.sub(r'^\s*[-*+]\s+', '', line)
                    processed_lines.append(f'<li>{item}</li>')
                elif re.match(r'^\s*\d+\.\s+', line):
                    if not in_list:
                        processed_lines.append('<ol>')
                        in_list = True
                    item = re.sub(r'^\s*\d+\.\s+', '', line)
                    processed_lines.append(f'<li>{item}</li>')
                else:
                    if in_list:
                        processed_lines.append('</ul>')
                        in_list = False
                    if line.strip():
                        processed_lines.append(f'<p>{line}</p>')
            if in_list:
                processed_lines.append('</ul>')
            section_html = '\n'.join(processed_lines)
            
            content_html += f'<div class="section-content">{section_html}</div>\n'
            
            # Add visualizations
            if visualizations:
                content_html += '<div class="visualizations">\n'
                for viz in visualizations:
                    if viz.get('html_path'):
                        html_path = Path(viz['html_path'])
                        if html_path.exists():
                            with open(html_path, 'r', encoding='utf-8') as f:
                                chart_html = f.read()
                            content_html += f'<div class="chart-container">{chart_html}</div>\n'
                    elif viz.get('png_path'):
                        png_path = Path(viz['png_path'])
                        if png_path.exists():
                            with open(png_path, 'rb') as f:
                                img_data = base64.b64encode(f.read()).decode('utf-8')
                            chart_title = viz.get('title', 'Chart')
                            content_html += f'<div class="chart-container"><img src="data:image/png;base64,{img_data}" alt="{chart_title}" style="max-width: 100%; height: auto;" /></div>\n'
                content_html += '</div>\n'
            
            content_html += '</div>\n'
        
        # Generate full HTML
        html_template = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Interactive Data Analysis Report</title>
    <style>
        body {{
            font-family: Arial, sans-serif;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f4f7f6;
        }}
        .tab {{
            overflow: hidden;
            border: 1px solid #ccc;
            background-color: #f1f1f1;
            border-radius: 8px 8px 0 0;
        }}
        .tab button {{
            background-color: inherit;
            float: left;
            border: none;
            outline: none;
            cursor: pointer;
            padding: 14px 16px;
            transition: 0.3s;
            font-size: 16px;
        }}
        .tab button:hover {{
            background-color: #ddd;
        }}
        .tab button.active {{
            background-color: #3f51b5;
            color: white;
        }}
        .tabcontent {{
            display: none;
            padding: 20px;
            border: 1px solid #ccc;
            border-top: none;
            background: white;
            border-radius: 0 0 8px 8px;
            min-height: 400px;
        }}
        .section-content {{
            line-height: 1.6;
            color: #333;
        }}
        .visualizations {{
            margin-top: 20px;
        }}
        .chart-container {{
            margin-bottom: 20px;
            border: 1px solid #e0e0e0;
            border-radius: 4px;
            padding: 10px;
            background: #fafafa;
        }}
        h1, h2, h3 {{
            color: #3f51b5;
        }}
        .selectable-content {{
            user-select: text;
            -webkit-user-select: text;
        }}
    </style>
</head>
<body>
    <div class="selectable-content">
        <h1>📊 Interactive Data Analysis Report</h1>
        <p><strong>Generated:</strong> {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
        <p><strong>User Query:</strong> {state.get('user_query', 'N/A')}</p>
        <hr>
        
        <div class="tab">
            {nav_html}
        </div>
        
        {content_html}
    </div>
    
    <script>
        function openSection(evt, sectionId) {{
            var i, tabcontent, tablinks;
            tabcontent = document.getElementsByClassName("tabcontent");
            for (i = 0; i < tabcontent.length; i++) {{
                tabcontent[i].style.display = "none";
            }}
            tablinks = document.getElementsByClassName("tablinks");
            for (i = 0; i < tablinks.length; i++) {{
                tablinks[i].classList.remove("active");
            }}
            document.getElementById(sectionId).style.display = "block";
            evt.currentTarget.classList.add("active");
        }}
        
        // Text selection detection
        document.addEventListener('mouseup', function() {{
            const selection = window.getSelection();
            const selectedText = selection.toString().trim();
            if (selectedText && selectedText.length >= 1 && selectedText.length <= 500) {{
                try {{
                    sessionStorage.setItem('pendingTextSelection_view_report', JSON.stringify({{
                        text: selectedText,
                        timestamp: Date.now()
                    }}));
                    if (window.parent && window.parent !== window) {{
                        window.parent.postMessage({{
                            type: 'textSelected',
                            text: selectedText
                        }}, '*');
                    }}
                }} catch (e) {{
                    console.error('Error storing selection:', e);
                }}
            }}
        }});
    </script>
</body>
</html>"""
        
        return html_template
    
    def finalize_node(self, state: HITLAnalysisWorkflowState) -> HITLAnalysisWorkflowState:
        """Compile all sections into final report and generate interactive HTML"""
        try:
            sections = state.get('generated_sections', [])
            
            # Generate markdown report
            report_parts = [
                "# Data Analysis Report\n",
                f"Generated on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n",
                f"User Query: {state.get('user_query', 'N/A')}\n",
                "---\n\n"
            ]
            
            for i, section in enumerate(sections, 1):
                if section:
                    report_parts.append(f"\n## Section {i}: {section.get('section_title', 'Untitled')}\n\n")
                    report_parts.append(section.get('content', ''))
                    report_parts.append("\n")
                    
                    # Add visualization references
                    if section.get('visualizations'):
                        report_parts.append("### Charts\n")
                        for viz in section['visualizations']:
                            if 'html_path' in viz:
                                report_parts.append(f"- [{viz.get('title', 'Chart')}]({viz['html_path']})\n")
            
            state['final_output'] = "\n".join(report_parts)
            state['final_output_original'] = state['final_output']  # Store original for comparison
            
            # Generate and save interactive HTML report
            try:
                html_report = self._generate_interactive_html_report(state)
                # Save to backend directory (where the script is running from)
                report_path = Path("interactive_analysis_report.html")
                # If running from app directory, go up one level
                if Path.cwd().name == "app":
                    report_path = Path("..") / report_path
                elif Path.cwd().name == "backend":
                    report_path = Path(".") / report_path
                else:
                    report_path = Path(".") / report_path
                
                report_path = report_path.resolve()
                report_path.parent.mkdir(parents=True, exist_ok=True)
                
                with open(report_path, 'w', encoding='utf-8') as f:
                    f.write(html_report)
                print(f"✅ Interactive HTML report saved to: {report_path}")
                # Also store the path in state for API access
                state['report_html_path'] = str(report_path)
            except Exception as e:
                print(f"⚠️ Warning: Could not generate HTML report: {str(e)}")
                import traceback
                traceback.print_exc()
                state['error_log'].append(f"HTML report generation error: {str(e)}")
            
            # Set step to trigger final report review
            state['current_step'] = 'finalized'
            
        except Exception as e:
            error_msg = f"Finalization error: {str(e)}"
            state['error_log'].append(error_msg)
            state['current_step'] = 'error'
        
        return state
    
    def final_report_review_node(self, state: HITLAnalysisWorkflowState) -> HITLAnalysisWorkflowState:
        """Pause point for final report review (no-op, just marks state)"""
        state['current_step'] = 'awaiting_final_report_review'
        return state
    
    def regenerate_final_report_node(self, state: HITLAnalysisWorkflowState) -> HITLAnalysisWorkflowState:
        """Regenerate final report based on feedback"""
        try:
            # Get feedback
            feedback = state.get('human_feedback', '')
            edited_content = state.get('edited_content', '')
            sentence_feedbacks = state.get('sentence_feedback', [])
            
            # Combine all feedback
            combined_feedback = ""
            if feedback:
                combined_feedback += f"General feedback: {feedback}\n"
            if edited_content:
                combined_feedback += f"Edited content provided: {edited_content}\n"
            if sentence_feedbacks:
                for sf in sentence_feedbacks:
                    combined_feedback += f"Feedback on '{sf.get('text', '')}': {sf.get('feedback', '')}\n"
            
            # Get original report
            original_report = state.get('final_output_original', state.get('final_output', ''))
            
            if combined_feedback or edited_content:
                # Regenerate using LLM
                try:
                    from langchain_groq import ChatGroq
                    from langchain_core.prompts import ChatPromptTemplate
                    
                    llm = ChatGroq(groq_api_key=self.groq_api_key, model="llama-3.3-70b-versatile", temperature=0.3)
                    
                    prompt = ChatPromptTemplate.from_template("""
                    Original Report:
                    {original_report}
                    
                    User Feedback and Edits:
                    {feedback}
                    
                    Please regenerate this report incorporating the user's feedback. Maintain the same structure and sections but improve the content based on the feedback.
                    If the user provided edited content, incorporate those edits appropriately.
                    IMPORTANT: Do not remove or change any image/chart references (lines starting with ! or containing image paths or links like [Title](path)).
                    """)
                    
                    response = llm.invoke(prompt.format(
                        original_report=original_report[:4000],  # Limit length
                        feedback=combined_feedback
                    ))
                    
                    state['final_output'] = response.content.strip()
                    
                except Exception as e:
                    # Fallback: use edited content if provided, otherwise keep original
                    if edited_content:
                        state['final_output'] = edited_content
                    else:
                        state['final_output'] = original_report
                    state['error_log'].append(f"Report regeneration error: {str(e)}")
            elif edited_content:
                # Direct edit without LLM regeneration
                state['final_output'] = edited_content
            
            # Reset feedback fields
            state['human_feedback'] = None
            state['edited_content'] = None
            state['sentence_feedback'] = None
            state['approval_status'] = 'pending'
            state['current_step'] = 'final_report_regenerated'
            
        except Exception as e:
            error_msg = f"Final report regeneration error: {str(e)}"
            state['error_log'].append(error_msg)
            state['current_step'] = 'error'
        
        return state


# =============================================================================
# ROUTER FUNCTIONS
# =============================================================================

def review_router(state: HITLAnalysisWorkflowState) -> str:
    """Route after human review based on approval status"""
    approval_status = state.get('approval_status', 'pending')
    current_idx = state.get('current_section_index', 0)
    plan = state.get('plan', [])
    current_step = state.get('current_step', '')
    
    # Handle final report review routing
    if current_step == 'awaiting_final_report_review':
        if approval_status == 'approved':
            return "end"
        elif approval_status == 'feedback':
            return "regenerate_final_report"
        else:
            return "final_report_review"
    
    # Handle section review routing
    if approval_status == 'approved':
        # Check if more sections to generate
        if current_idx + 1 < len(plan):
            return "next_section"
        else:
            return "finalize"
    elif approval_status == 'feedback':
        return "revise"
    else:
        # Default: wait for review
        return "human_review"

def final_report_router(state: HITLAnalysisWorkflowState) -> str:
    """Route after final report generation"""
    return "final_report_review"


# =============================================================================
# GRAPH CONSTRUCTION
# =============================================================================

def create_hitl_workflow(groq_api_key: str):
    """Create and compile the HITL workflow graph"""
    workflow_instance = HITLAnalysisWorkflow(groq_api_key)
    
    # Create graph
    workflow = StateGraph(HITLAnalysisWorkflowState)
    
    # Add nodes
    workflow.add_node("data_profiling", workflow_instance.data_profiling_node)
    workflow.add_node("planning", workflow_instance.planning_node)
    workflow.add_node("generate_section", workflow_instance.generate_section_node)
    workflow.add_node("human_review", workflow_instance.human_review_node)
    workflow.add_node("update_index", lambda state: {**state, 'current_section_index': state.get('current_section_index', 0) + 1})
    workflow.add_node("finalize", workflow_instance.finalize_node)
    workflow.add_node("final_report_review", workflow_instance.final_report_review_node)
    workflow.add_node("regenerate_final_report", workflow_instance.regenerate_final_report_node)
    
    # Set entry point
    workflow.set_entry_point("data_profiling")
    
    # Add edges
    workflow.add_edge("data_profiling", "planning")
    workflow.add_edge("planning", "generate_section")
    workflow.add_edge("generate_section", "human_review")
    
    # Conditional routing after section review
    workflow.add_conditional_edges(
        "human_review",
        review_router,
        {
            "next_section": "update_index",
            "revise": "generate_section",
            "finalize": "finalize",
            "human_review": "human_review",  # Stay in review if pending
            "final_report_review": "final_report_review"  # For final report review
        }
    )
    
    workflow.add_edge("update_index", "generate_section")
    
    # Route after finalization
    workflow.add_conditional_edges(
        "finalize",
        final_report_router,
        {
            "final_report_review": "final_report_review"
        }
    )
    
    # Conditional routing after final report review
    workflow.add_conditional_edges(
        "final_report_review",
        review_router,
        {
            "regenerate_final_report": "regenerate_final_report",
            "final_report_review": "final_report_review",  # Stay in review if pending
            "end": END
        }
    )
    
    workflow.add_edge("regenerate_final_report", "final_report_review")
    
    # Compile with checkpointer and interrupt
    memory = MemorySaver()
    app = workflow.compile(checkpointer=memory, interrupt_before=["human_review", "final_report_review"])
    
    return app, workflow_instance
