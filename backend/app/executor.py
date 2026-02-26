from app.utils import summarize_for_llm
from app.anl_funcs import SpecializedAnalytics
import json
from typing import TypedDict, List, Dict, Any, Optional, Tuple
import pandas as pd

# =============================================================================
# INTELLIGENT ANALYSIS EXECUTOR
# =============================================================================

class IntelligentAnalysisExecutor:
    """Executes the LLM-generated analysis plan using specialized functions"""
    
    @staticmethod
    def execute_analysis_plan(df: pd.DataFrame, plan: Dict[str, Any]) -> Dict[str, Any]:
        """Execute the specialized analyses defined in the plan"""
        
        results = {}
        print(plan.get('specialized_analyses', []))
        output_filename = 'analysis_results.txt'
        for analysis in plan.get('specialized_analyses', []):
            function_name = analysis.get('function')
            print(function_name)
            columns = analysis.get('columns', [])
            parameters = analysis.get('parameters', {})
            
            try:
                # Get the analysis function
                analysis_func = getattr(SpecializedAnalytics, function_name)
                
                # Execute analysis with appropriate parameters
                if function_name == 'time_series_decomposition':
                    if len(columns) >= 2:
                        result = analysis_func(df, columns[0], columns[1])
                elif function_name == 'cohort_analysis':
                    if len(columns) >= 2:
                        value_col = columns[2] if len(columns) > 2 else None
                        result = analysis_func(df, columns[0], columns[1], value_col)
                elif function_name == 'customer_segmentation':
                    if len(columns) >= 2:
                        result = analysis_func(df, columns[0], columns[1:])
                elif function_name == 'correlation_network_analysis':
                    threshold = parameters.get('threshold', 0.5)
                    result = analysis_func(df, columns, threshold)
                elif function_name == 'anomaly_detection':
                    result = analysis_func(df, columns)
                elif function_name == 'distribution_comparison':
                    if len(columns) >= 2:
                        result = analysis_func(df, columns[0], columns[1])
                else:
                    result = {'error': f'Unknown analysis function: {function_name}'}
                print(summarize_for_llm(result))
                
                results[f"{function_name}_{len(results)}"] = result
                
            except Exception as e:
                print(e)
                results[f"{function_name}_error"] = {'error': str(e)}
        try:
            results_string = json.dumps(results, indent=4) 
            with open(output_filename, 'w') as f:
                f.write(results_string)
            
            print(f"\n Results saved to plain text file {output_filename}.")
        except Exception as e:
            print(f"\n ERROR: Could not write results to text file: {e}")
        return results
