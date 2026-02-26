from app.utils import extract_json_from_response

from typing import TypedDict, List, Dict, Any, Optional, Tuple
import pandas as pd
import json
import numpy as np
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate

# =============================================================================
# ENHANCED INTELLIGENT ANALYSIS PLANNER
# =============================================================================

class IntelligentAnalysisPlanner:
    """Enhanced LLM-powered agent with comprehensive visualization options"""
    
    def __init__(self, groq_api_key: str):
        self.llm = ChatGroq(groq_api_key=groq_api_key, model="llama-3.3-70b-versatile", temperature=0.5)
    
    def create_analysis_plan(self, df: pd.DataFrame, dataset_info: Dict[str, Any]) -> Dict[str, Any]:
        """Create comprehensive analysis plan with full chart options"""
        
        data_profile = self._profile_dataset(df)
        print(data_profile)
        
        # Enhanced planning prompt with comprehensive options
        planning_prompt = ChatPromptTemplate.from_template("""
        You are an expert data scientist. Create a comprehensive analysis plan for this dataset. You can repeat functions and charts for different columns.
        
        Dataset Profile:
        {data_profile}
        
        AVAILABLE ANALYSIS FUNCTIONS:
        - time_series_decomposition: Temporal trends, seasonality, residuals
        - cohort_analysis: Customer retention and behavior over time  
        - customer_segmentation: RFM analysis and clustering
        - correlation_network_analysis: Variable relationships and dependencies
        - anomaly_detection: Outlier identification and scoring
        - distribution_comparison: Statistical group comparisons
        
        AVAILABLE CHART TYPES:
        - correlation_heatmap: For numeric variable relationships
        - time_series_line: For temporal data trends
        - bar_chart: For categorical comparisons
        - histogram: For distribution analysis
        - box_plot: For outlier and quartile analysis
        - scatter_plot: For two-variable relationships
        
        - violin_plot: For distribution shapes by groups (first col categorical)
        - bubble_chart: For three-dimensional relationships
        
        RELATIONSHIP TYPES:
        - temporal: Time-based relationships
        - categorical_numeric: Category vs numeric analysis
        - numeric_numeric: Correlation analysis
        - hierarchical: Parent-child relationships
        
        Create a JSON response with:
        {{
            "specialized_analyses": [
                {{
                    "function": "correlation_network_analysis",
                    "columns": ["Sales", "Profit", "Discount"],
                    "parameters": {{"threshold": 0.5}},
                    "justification": "Multiple numeric columns for correlation analysis"
                }}
            ],
            "visualizations": [
                {{
                    "chart_type": "correlation_heatmap",
                    "columns": ["Sales", "Profit", "Discount"],
                    "title": "Sales Performance Correlation Matrix",
                    "insights_focus": "Identify key performance drivers"
                }},
                {{
                    "chart_type": "time_series_line",
                    "columns": ["Order_Date", "Sales"],
                    "title": "Sales Trend Over Time",
                    "insights_focus": "Seasonal patterns and growth trends"
                }}
            ],
        }}
        """)
        
        try:
            response = self.llm.invoke(planning_prompt.format(data_profile=json.dumps(data_profile, indent=2)))
            plan = extract_json_from_response(response.content)
            
            if plan:
                validated_plan = self._validate_analysis_plan(plan, df)
                return validated_plan
            else:
                print("  LLM planning failed, using enhanced fallback")
                return self._create_enhanced_fallback_plan(df, data_profile)
                
        except Exception as e:
            print(f" LLM planning failed: {str(e)}, using enhanced fallback")
            return self._create_enhanced_fallback_plan(df, data_profile)
    
    def _create_enhanced_fallback_plan(self, df: pd.DataFrame, profile: Dict[str, Any]) -> Dict[str, Any]:
        """Enhanced fallback with comprehensive chart selection"""
        
        plan = {
            'specialized_analyses': [],
            'visualizations': []
        }
        
        numeric_cols = profile.get('numeric_columns', {}).get('columns', [])
        categorical_cols = profile.get('categorical_columns', {}).get('columns', [])
        date_cols = profile.get('date_columns', {}).get('columns', [])
        
        # Filter meaningful columns
        meaningful_numeric = [col for col in numeric_cols if not any(term in col.lower() 
                            for term in ['id', 'row', 'postal', 'zip', 'code'])]
        
        # Add specialized analyses
        if len(meaningful_numeric) >= 3:
            plan['specialized_analyses'].append({
                'function': 'correlation_network_analysis',
                'columns': meaningful_numeric[:5],
                'parameters': {'threshold': 0.5},
                'justification': 'Multiple numeric columns for correlation analysis'
            })
        
        if len(meaningful_numeric) >= 2:
            plan['specialized_analyses'].append({
                'function': 'anomaly_detection',
                'columns': meaningful_numeric[:3],
                'parameters': {},
                'justification': 'Numeric data for outlier detection'
            })
        
        if date_cols and meaningful_numeric:
            plan['specialized_analyses'].append({
                'function': 'time_series_decomposition',
                'columns': [date_cols[0], meaningful_numeric[0]],
                'parameters': {},
                'justification': 'Time series data detected'
            })
        
        # Add comprehensive visualizations
        if len(meaningful_numeric) >= 3:
            plan['visualizations'].append({
                'chart_type': 'correlation_heatmap',
                'columns': meaningful_numeric[:6],
                'title': 'Variable Correlation Matrix',
                'insights_focus': 'Identify key relationships'
            })
        
        if date_cols and meaningful_numeric:
            plan['visualizations'].append({
                'chart_type': 'time_series_line',
                'columns': [date_cols[0], meaningful_numeric[0]],
                'title': 'Trend Analysis Over Time',
                'insights_focus': 'Temporal patterns and trends'
            })
        
        if categorical_cols and meaningful_numeric:
            plan['visualizations'].append({
                'chart_type': 'bar_chart',
                'columns': [categorical_cols[0], meaningful_numeric[0]],
                'title': f'{meaningful_numeric[0]} by {categorical_cols[0]}',
                'insights_focus': 'Category performance comparison'
            })
        
        if len(meaningful_numeric) >= 1:
            plan['visualizations'].append({
                'chart_type': 'histogram',
                'columns': [meaningful_numeric[0]],
                'title': f'{meaningful_numeric[0]} Distribution',
                'insights_focus': 'Data distribution and outliers'
            })
        
        if len(meaningful_numeric) >= 2:
            plan['visualizations'].append({
                'chart_type': 'scatter_plot',
                'columns': meaningful_numeric[:2],
                'title': f'{meaningful_numeric[0]} vs {meaningful_numeric[1]}',
                'insights_focus': 'Relationship between variables'
            })
        
        return plan
    
    def _profile_dataset(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Create comprehensive dataset profile"""
        
        profile = {
            'shape': df.shape,
            'columns': df.columns.tolist(),
            'dtypes': {str(k): str(v) for k, v in df.dtypes.to_dict().items()},
            'missing_percentage': {col: float((df[col].isnull().sum() / len(df)) * 100) for col in df.columns}
        }
        
        # Column type analysis
        numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
        categorical_cols = df.select_dtypes(include=['object', 'category']).columns.tolist()
        date_cols = df.select_dtypes(include=['datetime64', 'datetime']).columns.tolist()
        
        if numeric_cols:
            profile['numeric_columns'] = {
                'columns': numeric_cols,
                'summary': {col: {
                    'mean': float(df[col].mean()),
                    'std': float(df[col].std()),
                    'min': float(df[col].min()),
                    'max': float(df[col].max())
                } for col in numeric_cols}  # Limit for token size
            }
        
        if categorical_cols:
            profile['categorical_columns'] = {
                'columns': categorical_cols,
                'cardinality': {col: int(df[col].nunique()) for col in categorical_cols}
            }
        
        if date_cols:
            profile['date_columns'] = {
                'columns': date_cols,
                'date_range': {col: {
                    'min': df[col].min().isoformat() if pd.notna(df[col].min()) else None,
                    'max': df[col].max().isoformat() if pd.notna(df[col].max()) else None
                } for col in date_cols}
            }
        
        # Business context detection
        col_lower = [col.lower() for col in df.columns]
        profile['business_context'] = {
            'is_sales_data': any(term in ' '.join(col_lower) for term in ['sales', 'revenue', 'profit', 'order']),
            'is_customer_data': any(term in ' '.join(col_lower) for term in ['customer', 'client']),
            'is_geographic': any(term in ' '.join(col_lower) for term in ['city', 'state', 'country', 'region']),
            'has_temporal': len(date_cols) > 0,
            'has_products': any(term in ' '.join(col_lower) for term in ['product', 'category', 'item'])
        }
        
        return profile
    
    def _validate_analysis_plan(self, plan: Dict[str, Any], df: pd.DataFrame) -> Dict[str, Any]:
        """Validate plan against available data"""
        
        validated_plan = {
            'specialized_analyses': [],
            'visualizations': []
        }
        
        available_columns = set(df.columns)
        
        # Validate analyses
        for analysis in plan.get('specialized_analyses', []):
            columns = set(analysis.get('columns', []))
            if columns.issubset(available_columns):
                validated_plan['specialized_analyses'].append(analysis)
        
        # Validate visualizations
        for viz in plan.get('visualizations', []):
            columns = set(viz.get('columns', []))
            if columns.issubset(available_columns):
                validated_plan['visualizations'].append(viz)
        
        return validated_plan
