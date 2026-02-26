from typing import TypedDict, List, Dict, Any, Optional, Tuple
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from datetime import datetime, date
import os


# =============================================================================
# COMPREHENSIVE VISUALIZATION GENERATOR
# =============================================================================


class ComprehensiveVisualizationGenerator:
    """Complete visualization generator with all chart types"""
    _DEFAULT_SKEW_THRESHOLD = 1.0  # absolute skew above this will trigger log1p transform


    # ------------------------- Helper utilities -------------------------
    @staticmethod
    def _is_skewed(series: pd.Series, skew_threshold: float = None) -> bool:
        # will never show skewed
        return False
        if skew_threshold is None:
            skew_threshold = ComprehensiveVisualizationGenerator._DEFAULT_SKEW_THRESHOLD
        if series is None or series.dropna().empty:
            return False
        try:
            skewness = float(series.dropna().skew())
        except Exception:
            return False
        return abs(skewness) >= float(skew_threshold)


    @staticmethod
    def _log_transform_for_plot(series: pd.Series) -> Tuple[pd.Series, Dict[str, Any]]:
        """Return transformed series and metadata.


        - Uses np.log1p(x + offset) where offset = max(0, -min(series)) + tiny_eps
        - Metadata includes: applied (bool), offset, original_min, original_max
        """
        meta = {'applied': False, 'offset': 0.0, 'original_min': None, 'original_max': None}
        if series is None:
            return series, meta


        s = series.astype('float').copy()
        s_non_na = s.dropna()
        if s_non_na.empty:
            return s, meta


        min_val = float(s_non_na.min())
        max_val = float(s_non_na.max())
        meta['original_min'] = min_val
        meta['original_max'] = max_val


        # Prepare offset so values > -1 for log1p
        offset = 0.0
        if min_val <= -1:
            offset = abs(min_val) + 1e-6
        elif min_val < 0:
            # if min is between -1 and 0, small offset to avoid edge effects
            offset = 1e-6


        try:
            transformed = np.log1p(s + offset)
            meta.update({'applied': True, 'offset': offset})
            return transformed, meta
        except Exception:
            return s, meta


    @staticmethod
    def _apply_transform_if_needed(series: pd.Series, skew_threshold: float = None) -> Tuple[pd.Series, Dict[str, Any]]:
        """Check skew and apply log transform if needed. Returns (series_for_plot, meta)."""
        if series is None:
            return series, {'applied': False}
        if not pd.api.types.is_numeric_dtype(series):
            return series, {'applied': False}
        if ComprehensiveVisualizationGenerator._is_skewed(series, skew_threshold=skew_threshold):
            return ComprehensiveVisualizationGenerator._log_transform_for_plot(series)
        return series, {'applied': False}


    @staticmethod
    def _annotate_title_with_transform(title: str, meta: Dict[str, Any]) -> str:
        if meta.get('applied'):
            return f"{title} (log-transformed, offset={meta.get('offset', 0):.6g})"
        return title


    # ------------------------- Public chart creation -------------------------
    @staticmethod
    def create_intelligent_charts(df: pd.DataFrame, plan: Dict[str, Any], analysis_results: Dict[str, Any]) -> Tuple[List[str], List[str]]:
        """Create comprehensive visualizations
        
        Returns:
            Tuple of (chart_paths_png, chart_paths_html)
        """
        
        chart_paths_png = []
        chart_paths_html = []
        
        try:
            # Create charts from analysis results
            for analysis_key, analysis_result in analysis_results.items():
                if 'error' in analysis_result:
                    continue
                
                analysis_type = analysis_result.get('analysis_type', '')
                
                if analysis_type == 'correlation_network':
                    png_path, html_path = ComprehensiveVisualizationGenerator._create_correlation_network_chart(
                        analysis_result, f"correlation_network_{len(chart_paths_png)}")
                    if png_path:
                        chart_paths_png.append(png_path)
                    if html_path:
                        chart_paths_html.append(html_path)
                
                elif analysis_type == 'time_series_decomposition':
                    png_path, html_path = ComprehensiveVisualizationGenerator._create_time_series_decomposition_chart(
                        analysis_result, f"time_series_decomp_{len(chart_paths_png)}")
                    if png_path:
                        chart_paths_png.append(png_path)
                    if html_path:
                        chart_paths_html.append(html_path)
                
                elif analysis_type == 'customer_segmentation':
                    png_path, html_path = ComprehensiveVisualizationGenerator._create_customer_segmentation_chart(
                        analysis_result, f"customer_segments_{len(chart_paths_png)}")
                    if png_path:
                        chart_paths_png.append(png_path)
                    if html_path:
                        chart_paths_html.append(html_path)
                
                elif analysis_type == 'anomaly_detection':
                    png_path, html_path = ComprehensiveVisualizationGenerator._create_anomaly_detection_chart(
                        analysis_result, f"anomaly_detection_{len(chart_paths_png)}")
                    if png_path:
                        chart_paths_png.append(png_path)
                    if html_path:
                        chart_paths_html.append(html_path)
            
            # Create charts from visualization plan
            for viz_plan in plan.get('visualizations', []):
                chart_type = viz_plan.get('chart_type', '')
                columns = viz_plan.get('columns', [])
                title = viz_plan.get('title', 'Chart')
                
                png_path = None
                html_path = None
                
                if chart_type == 'correlation_heatmap' and len(columns) > 1:
                    png_path, html_path = ComprehensiveVisualizationGenerator._create_correlation_heatmap(
                        df, columns, f"correlation_heatmap_{len(chart_paths_png)}", title)
                
                elif chart_type in ('time_series_line', 'line_chart') and len(columns) >= 2:
                    png_path, html_path = ComprehensiveVisualizationGenerator._create_time_series_line(
                        df, columns[0], columns[1], f"time_series_{len(chart_paths_png)}", title)
                
                elif chart_type == 'bar_chart' and len(columns) >= 2:
                    png_path, html_path = ComprehensiveVisualizationGenerator._create_bar_chart(
                        df, columns[0], columns[1], f"bar_chart_{len(chart_paths_png)}", title)
                
                elif chart_type == 'histogram' and len(columns) >= 1:
                    png_path, html_path = ComprehensiveVisualizationGenerator._create_histogram(
                        df, columns[0], f"histogram_{len(chart_paths_png)}", title)
                
                elif chart_type == 'scatter_plot' and len(columns) >= 2:
                    png_path, html_path = ComprehensiveVisualizationGenerator._create_scatter_plot(
                        df, columns[0], columns[1], f"scatter_{len(chart_paths_png)}", title)
                
                elif chart_type == 'pie_chart' and len(columns) >= 1:
                    png_path, html_path = ComprehensiveVisualizationGenerator._create_pie_chart(
                        df, columns[0], f"pie_chart_{len(chart_paths_png)}", title)
                
                elif chart_type == 'box_plot' and len(columns) >= 1:
                    png_path, html_path = ComprehensiveVisualizationGenerator._create_box_plot(
                        df, columns, f"box_plot_{len(chart_paths_png)}", title)
                
                elif chart_type == 'violin_plot' and len(columns) >= 2:
                    png_path, html_path = ComprehensiveVisualizationGenerator._create_violin_plot(
                        df, columns[0], columns[1], f"violin_{len(chart_paths_png)}", title)
                
                elif chart_type == 'bubble_chart' and len(columns) >= 3:
                    png_path, html_path = ComprehensiveVisualizationGenerator._create_bubble_chart(
                        df, columns[0], columns[1], columns[2], f"bubble_{len(chart_paths_png)}", title)
                
                elif chart_type == 'treemap' and len(columns) >= 2:
                    png_path, html_path = ComprehensiveVisualizationGenerator._create_treemap(
                        df, columns[0], columns[1], f"treemap_{len(chart_paths_png)}", title)
                
                if png_path:
                    chart_paths_png.append(png_path)
                if html_path:
                    chart_paths_html.append(html_path)
        
        except Exception as e:
            print(f"  Chart generation error: {str(e)}")
        
        return chart_paths_png, chart_paths_html
    
    # =============================================================================
    # INDIVIDUAL CHART CREATION METHODS
    # =============================================================================
    
    @staticmethod
    def _create_correlation_heatmap(df: pd.DataFrame, columns: List[str], filename: str, title: str) -> Tuple[Optional[str], Optional[str]]:
        """Create correlation heatmap"""
        try:
            # Filter numeric columns only
            numeric_cols = [col for col in columns if col in df.select_dtypes(include=[np.number]).columns]
            if len(numeric_cols) < 2:
                return None, None
            
            corr_matrix = df[numeric_cols].corr()
            
            fig = go.Figure(data=go.Heatmap(
                z=corr_matrix.values,
                x=corr_matrix.columns,
                y=corr_matrix.columns,
                colorscale='RdBu',
                zmid=0,
                text=corr_matrix.round(3).values,
                texttemplate="%{text}",
                textfont={"size": 10}
            ))
            
            fig.update_layout(title=title, height=600, width=800)
            return ComprehensiveVisualizationGenerator._save_chart(fig, filename)
        except Exception as e:
            print(f"Error creating correlation heatmap: {str(e)}")
            return None, None
    
    @staticmethod
    def _create_time_series_line(df: pd.DataFrame, date_col: str, value_col: str, filename: str, title: str) -> Tuple[Optional[str], Optional[str]]:
        """Create time series line chart"""
        try:
            if date_col not in df.columns or value_col not in df.columns:
                return None, None
            
            df_ts = df.copy()
            df_ts[date_col] = pd.to_datetime(df_ts[date_col])
            df_ts = df_ts.sort_values(date_col)
            df_ts[date_col] = df_ts[date_col].dt.strftime('%Y-%m-%d')


            
            fig = go.Figure()
            fig.add_trace(go.Scatter(
                x=df_ts[date_col], 
                y=df_ts[value_col], 
                mode='lines+markers',
                name=value_col,
                line=dict(width=2),
                marker=dict(size=4)
            ))


            
            fig.update_layout(
                title=title,
                xaxis_title=date_col,
                yaxis_title=value_col,
                height=500
            )


            
            return ComprehensiveVisualizationGenerator._save_chart(fig, filename)
        except Exception as e:
            print(f"Error creating time series chart: {str(e)}")
            return None, None
        
    
    @staticmethod
    def _create_bar_chart(df: pd.DataFrame, cat_col: str, value_col: str, filename: str, title: str) -> Tuple[Optional[str], Optional[str]]:
        try:
            if cat_col not in df.columns or value_col not in df.columns:
                return None, None


            agg_data = df.groupby(cat_col)[value_col].agg(['sum', 'mean', 'count', 'std']).reset_index()
            agg_data = agg_data.sort_values('sum', ascending=False).head(15)


            # Decide whether to log-transform the 'sum' column for plotting
            sum_series = agg_data['sum']
            sum_plot, meta_sum = ComprehensiveVisualizationGenerator._apply_transform_if_needed(sum_series)
            title = ComprehensiveVisualizationGenerator._annotate_title_with_transform(title, meta_sum)


            fig = make_subplots(
                rows=2, cols=2,
                subplot_titles=(f'Total {value_col} by {cat_col}', f'Average {value_col}', 'Count of Records', 'Standard Deviation'),
                specs=[[{"type": "bar"}, {"type": "bar"}],
                       [{"type": "bar"}, {"type": "bar"}]]
            )


            fig.add_trace(go.Bar(x=agg_data[cat_col], y=sum_plot, text=agg_data['sum'].round(2), textposition='auto', name='Total', showlegend=False), row=1, col=1)
            fig.add_trace(go.Bar(x=agg_data[cat_col], y=agg_data['mean'], text=agg_data['mean'].round(2), textposition='auto', name='Average', showlegend=False), row=1, col=2)
            fig.add_trace(go.Bar(x=agg_data[cat_col], y=agg_data['count'], text=agg_data['count'], textposition='auto', name='Count', showlegend=False), row=2, col=1)
            fig.add_trace(go.Bar(x=agg_data[cat_col], y=agg_data['std'], text=agg_data['std'].round(2), textposition='auto', name='Std Dev', showlegend=False), row=2, col=2)


            fig.update_layout(title=title, height=800, showlegend=False)
            return ComprehensiveVisualizationGenerator._save_chart(fig, filename)


        except Exception as e:
            print(f"Error creating enhanced bar chart: {str(e)}")
            return None, None


    @staticmethod
    def _create_histogram(df: pd.DataFrame, column: str, filename: str, title: str) -> Tuple[Optional[str], Optional[str]]:
        try:
            if column not in df.columns:
                return None, None


            series = df[column]
            series_plot, meta = ComprehensiveVisualizationGenerator._apply_transform_if_needed(series)
            title = ComprehensiveVisualizationGenerator._annotate_title_with_transform(title, meta)


            fig = go.Figure()
            fig.add_trace(go.Histogram(
                x=series_plot,
                nbinsx=30,
                marker=dict(opacity=0.75),
                name=column
            ))


            fig.update_layout(title=title, xaxis_title=column, yaxis_title='Frequency', height=500)
            return ComprehensiveVisualizationGenerator._save_chart(fig, filename)
        except Exception as e:
            print(f"Error creating histogram: {str(e)}")
            return None, None


    @staticmethod
    def _create_scatter_plot(df: pd.DataFrame, x_col: str, y_col: str, filename: str, title: str, color_col: str = None) -> Tuple[Optional[str], Optional[str]]:
        try:
            if x_col not in df.columns or y_col not in df.columns:
                return None, None


            df_sample = df.sample(min(2000, len(df)))


            x_plot, meta_x = ComprehensiveVisualizationGenerator._apply_transform_if_needed(df_sample[x_col])
            y_plot, meta_y = ComprehensiveVisualizationGenerator._apply_transform_if_needed(df_sample[y_col])


            title = ComprehensiveVisualizationGenerator._annotate_title_with_transform(title, {'applied': meta_x.get('applied') or meta_y.get('applied')})


            fig = go.Figure()
            if color_col and color_col in df_sample.columns:
                categories = df_sample[color_col].unique()[:10]
                for cat in categories:
                    mask = df_sample[color_col] == cat
                    fig.add_trace(go.Scatter(x=x_plot[mask], y=y_plot[mask], mode='markers', marker=dict(size=6, opacity=0.7), name=str(cat)))
            else:
                fig.add_trace(go.Scatter(x=x_plot, y=y_plot, mode='markers',
                                         marker=dict(size=6, opacity=0.6, color=y_plot, colorscale='Viridis', showscale=True),
                                         name=f'{x_col} vs {y_col}'))


            # trend line (try)
            try:
                from scipy import stats
                valid_mask = (~np.isnan(x_plot)) & (~np.isnan(y_plot))
                if valid_mask.sum() > 2:
                    slope, intercept, r_value, p_value, std_err = stats.linregress(x_plot[valid_mask], y_plot[valid_mask])
                    x_trend = np.array([x_plot.min(), x_plot.max()])
                    y_trend = slope * x_trend + intercept
                    fig.add_trace(go.Scatter(x=x_trend, y=y_trend, mode='lines', line=dict(width=2, dash='dash'), name=f'Trend (R²={r_value**2:.3f})'))
            except Exception:
                pass


            fig.update_layout(title=title, xaxis_title=x_col, yaxis_title=y_col, height=600)
            return ComprehensiveVisualizationGenerator._save_chart(fig, filename)
        except Exception as e:
            print(f"Error creating enhanced scatter plot: {str(e)}")
            return None, None


    @staticmethod
    def _create_pie_chart(df: pd.DataFrame, column: str, filename: str, title: str) -> Tuple[Optional[str], Optional[str]]:
        """Create pie chart"""
        try:
            if column not in df.columns:
                return None, None
            
            # Get value counts
            value_counts = df[column].value_counts().head(10)  # Top 10
            
            fig = go.Figure()
            fig.add_trace(go.Pie(
                labels=value_counts.index,
                values=value_counts.values,
                hole=0.3  # Donut style
            ))
            
            fig.update_layout(
                title=title,
                height=500
            )
            
            return ComprehensiveVisualizationGenerator._save_chart(fig, filename)
        except Exception as e:
            print(f"Error creating pie chart: {str(e)}")
            return None, None
    
    @staticmethod
    def _create_box_plot(df: pd.DataFrame, columns: List[str], filename: str, title: str) -> Tuple[Optional[str], Optional[str]]:
        try:
            numeric_cols = [col for col in columns if col in df.select_dtypes(include=[np.number]).columns]
            if not numeric_cols:
                return None, None


            fig = go.Figure()
            applied_any = False
            for col in numeric_cols[:5]:
                series_plot, meta = ComprehensiveVisualizationGenerator._apply_transform_if_needed(df[col])
                trace_name = f"{col}"
                if meta.get('applied'):
                    trace_name += " (log)"
                    applied_any = True
                fig.add_trace(go.Box(y=series_plot, name=trace_name, boxpoints='outliers'))


            title = ComprehensiveVisualizationGenerator._annotate_title_with_transform(title, {'applied': applied_any})
            fig.update_layout(title=title, yaxis_title='Values', height=500)
            return ComprehensiveVisualizationGenerator._save_chart(fig, filename)
        except Exception as e:
            print(f"Error creating box plot: {str(e)}")
            return None, None


    @staticmethod
    def _create_violin_plot(df: pd.DataFrame, cat_col: str, value_col: str, filename: str, title: str) -> Tuple[Optional[str], Optional[str]]:
        """Create violin plot (categories on x-axis, numeric on y-axis)"""
        try:
            if cat_col not in df.columns or value_col not in df.columns:
                return None, None


            fig = go.Figure()
            categories = pd.Series(df[cat_col]).dropna().unique()[:8]  # Limit to 8 categories


            for cat in categories:
                cat_data = df[df[cat_col] == cat][value_col].dropna()
                if cat_data.empty:
                    continue


                fig.add_trace(go.Violin(
                    x=[str(cat)] * len(cat_data),   # explicit category on x-axis
                    y=cat_data,
                    name=str(cat),
                    box_visible=True,
                    meanline_visible=True,
                    points='outliers'               # show outliers if you want points
                ))


            fig.update_layout(
                title=title,
                xaxis_title=cat_col,
                yaxis_title=value_col,
                height=500
            )


            return ComprehensiveVisualizationGenerator._save_chart(fig, filename)
        except Exception as e:
            print(f"Error creating violin plot: {str(e)}")
            return None, None


    @staticmethod
    def _create_bubble_chart(df: pd.DataFrame, x_col: str, y_col: str, size_col: str, filename: str, title: str) -> Tuple[Optional[str], Optional[str]]:
        try:
            if not all(col in df.columns for col in [x_col, y_col, size_col]):
                return None, None


            df_sample = df.sample(min(500, len(df))).copy()


            # Apply transforms individually
            x_plot, meta_x = ComprehensiveVisualizationGenerator._apply_transform_if_needed(df_sample[x_col])
            y_plot, meta_y = ComprehensiveVisualizationGenerator._apply_transform_if_needed(df_sample[y_col])
            size_plot, meta_s = ComprehensiveVisualizationGenerator._apply_transform_if_needed(df_sample[size_col])


            title = ComprehensiveVisualizationGenerator._annotate_title_with_transform(title, {'applied': meta_x.get('applied') or meta_y.get('applied') or meta_s.get('applied')})


            # ensure positive for sizing
            safe_size = size_plot.fillna(0).astype(float).abs().replace(0, 1)
            sizeref = 2. * safe_size.max() / (40. ** 2)


            fig = go.Figure()
            fig.add_trace(go.Scatter(
                x=x_plot,
                y=y_plot,
                mode='markers',
                marker=dict(size=size_plot, sizemode='diameter', sizeref=sizeref, sizemin=4, opacity=0.6, color=size_plot, colorscale='Viridis', showscale=True),
                text=[f'{x_col}: {x}<br>{y_col}: {y}<br>{size_col}: {s}' for x, y, s in zip(x_plot, y_plot, size_plot)],
                hovertemplate='%{text}<extra></extra>'
            ))


            fig.update_layout(title=title, xaxis_title=x_col, yaxis_title=y_col, height=500)
            return ComprehensiveVisualizationGenerator._save_chart(fig, filename)
        except Exception as e:
            print(f"Error creating bubble chart: {str(e)}")
            return None, None


    @staticmethod
    def _create_treemap(df: pd.DataFrame, cat_col: str, value_col: str, filename: str, title: str) -> Tuple[Optional[str], Optional[str]]:
        try:
            if cat_col not in df.columns or value_col not in df.columns:
                return None, None
            agg_data = df.groupby(cat_col)[value_col].sum().reset_index()
            agg_data = agg_data.sort_values(value_col, ascending=False).head(20)


            # Apply log transform if skewed
            val_plot, meta = ComprehensiveVisualizationGenerator._apply_transform_if_needed(agg_data[value_col])
            title = ComprehensiveVisualizationGenerator._annotate_title_with_transform(title, meta)


            fig = go.Figure(go.Treemap(labels=agg_data[cat_col].astype(str), values=val_plot, parents=[""] * len(agg_data), textinfo="label+value+percent parent"))
            fig.update_layout(title=title, height=500)
            return ComprehensiveVisualizationGenerator._save_chart(fig, filename)
        except Exception as e:
            print(f"Error creating treemap: {str(e)}")
            return None, None


    # Add the existing methods from the original code
    @staticmethod
    def _create_correlation_network_chart(analysis_result: Dict[str, Any], filename: str) -> Tuple[Optional[str], Optional[str]]:
        """Create enhanced correlation network visualization - IMPROVED VERSION"""
        try:
            correlations = analysis_result.get('strong_correlations', [])
            correlation_matrix = analysis_result.get('correlation_matrix', {})
            
            if not correlations:
                return None, None
            
            # Create a proper network-style visualization
            fig = make_subplots(
                rows=1, cols=2,
                subplot_titles=('Correlation Network', 'Correlation Strength Distribution'),
                specs=[[{"type": "scatter"}, {"type": "histogram"}]]
            )
            
            # 1. Network visualization
            # Create nodes (variables)
            nodes = set()
            for corr in correlations:
                nodes.add(corr['source'])
                nodes.add(corr['target'])
            
            nodes = list(nodes)
            node_positions = {}
            
            # Arrange nodes in a circle
            import math
            for i, node in enumerate(nodes):
                angle = 2 * math.pi * i / len(nodes)
                node_positions[node] = (math.cos(angle), math.sin(angle))
            
            # Draw edges (correlations)
            for corr in correlations:
                source_pos = node_positions[corr['source']]
                target_pos = node_positions[corr['target']]
                
                # Line thickness based on correlation strength
                line_width = abs(corr['correlation']) * 10
                line_color = 'red' if corr['correlation'] < 0 else 'blue'
                
                fig.add_trace(go.Scatter(
                    x=[source_pos[0], target_pos[0], None],
                    y=[source_pos[1], target_pos[1], None],
                    mode='lines',
                    line=dict(width=line_width, color=line_color),
                    opacity=abs(corr['correlation']),
                    showlegend=False,
                    hovertemplate=f'{corr["source"]} ↔ {corr["target"]}<br>r = {corr["correlation"]:.3f}'
                ), row=1, col=1)
            
            # Draw nodes
            for node in nodes:
                pos = node_positions[node]
                fig.add_trace(go.Scatter(
                    x=[pos[0]], y=[pos[1]],
                    mode='markers+text',
                    marker=dict(size=20, color='lightblue', line=dict(width=2, color='black')),
                    text=[node],
                    textposition='middle center',
                    showlegend=False
                ), row=1, col=1)
            
            # 2. Correlation strength distribution
            correlations_values = [abs(corr['correlation']) for corr in correlations]
            fig.add_trace(go.Histogram(
                x=correlations_values,
                nbinsx=15,
                marker=dict(color='green', opacity=0.7),
                name='Correlation Strengths',
                showlegend=False
            ), row=1, col=2)
            
            fig.update_layout(
                title="Enhanced Correlation Network Analysis",
                height=600,
                showlegend=False
            )
            
            # Remove axes for network plot
            fig.update_xaxes(showgrid=False, zeroline=False, showticklabels=False, row=1, col=1)
            fig.update_yaxes(showgrid=False, zeroline=False, showticklabels=False, row=1, col=1)
            
            return ComprehensiveVisualizationGenerator._save_chart(fig, filename)
            
        except Exception as e:
            print(f"Error creating enhanced correlation network chart: {str(e)}")
            return None, None
    
    @staticmethod
    def _create_time_series_decomposition_chart(analysis_result: Dict[str, Any], filename: str) -> Tuple[Optional[str], Optional[str]]:
        """Create enhanced time series decomposition - IMPROVED VERSION"""
        try:
            trend = analysis_result.get('trend', {})
            seasonal = analysis_result.get('seasonal', {})
            residual = analysis_result.get('residual', {})
            observed = analysis_result.get('observed', {})
            
            if not trend:
                return None, None
            
            fig = make_subplots(
                rows=4, cols=1,
                subplot_titles=('Original Time Series', 'Trend Component', 'Seasonal Component', 'Residual Component'),
                vertical_spacing=0.08
            )
            
            # Convert dict data to lists for plotting
            dates = list(trend.keys())
            
            # Sort by date if possible
            try:
                dates_sorted = sorted(dates, key=lambda x: pd.to_datetime(x))
                dates = dates_sorted
            except:
                pass
            
            trend_values = [trend[date] for date in dates]
            seasonal_values = [seasonal.get(date, 0) for date in dates]
            residual_values = [residual.get(date, 0) for date in dates]
            observed_values = [observed.get(date, 0) for date in dates] if observed else trend_values
            
            # 1. Original time series
            fig.add_trace(go.Scatter(
                x=dates, y=observed_values, 
                mode='lines',
                line=dict(color='black', width=2),
                name="Observed"
            ), row=1, col=1)
            
            # 2. Trend with confidence band
            fig.add_trace(go.Scatter(
                x=dates, y=trend_values, 
                mode='lines',
                line=dict(color='blue', width=3),
                name="Trend"
            ), row=2, col=1)
            
            # 3. Seasonal pattern with markers
            fig.add_trace(go.Scatter(
                x=dates, y=seasonal_values, 
                mode='lines+markers',
                line=dict(color='green', width=2),
                marker=dict(size=4),
                name="Seasonal"
            ), row=3, col=1)
            
            # 4. Residuals with zero line
            fig.add_trace(go.Scatter(
                x=dates, y=residual_values, 
                mode='markers',
                marker=dict(color='red', size=3),
                name="Residual"
            ), row=4, col=1)
            
            # Add zero line for residuals
            fig.add_hline(y=0, line_dash="dash", line_color="gray", row=4, col=1)
            
            fig.update_layout(
                title="Enhanced Time Series Decomposition Analysis",
                height=1000,
                showlegend=False
            )
            
            return ComprehensiveVisualizationGenerator._save_chart(fig, filename)
            
        except Exception as e:
            print(f"Error creating enhanced time series decomposition chart: {str(e)}")
            return None, None
    
    @staticmethod
    def _create_customer_segmentation_chart(analysis_result: Dict[str, Any], filename: str) -> Tuple[Optional[str], Optional[str]]:
        try:
            segment_summary = analysis_result.get('segment_summary', {})
            customer_segments = analysis_result.get('customer_segments', [])


            if not segment_summary:
                return None, None


            # Normalize clusters: keep as str for labels
            clusters = [str(c) for c in segment_summary.keys()]


            # Extract features from the first cluster entry
            features = list(next(iter(segment_summary.values())).keys()) if clusters else []


            fig = make_subplots(
                rows=2, cols=2,
                subplot_titles=('Segment Comparison','Segment Sizes','Feature Radar','Segment Distribution'),
                specs=[[{"type":"bar"},{"type":"pie"}],
                    [{"type":"scatterpolar"},{"type":"histogram"}]]
            )


            # 1. Feature comparison (bar chart)
            for feature in features[:5]:  # take up to 5 features
                values = [segment_summary[c][feature] for c in clusters if feature in segment_summary[c]]
                fig.add_trace(go.Bar(
                    x=clusters,
                    y=values,
                    name=feature
                ), row=1, col=1)


            # 2. Segment sizes (pie chart)
            if customer_segments:
                df_cust = pd.DataFrame(customer_segments)
                if 'cluster' in df_cust.columns:
                    counts = df_cust['cluster'].astype(str).value_counts()
                    fig.add_trace(go.Pie(
                        labels=[f"Segment {c}" for c in counts.index],
                        values=counts.values,
                        hole=0.4
                    ), row=1, col=2)


            # 3. Radar chart
            if len(features) >= 3:
                radar_feats = features[:6]  # up to 6 features
                for c in clusters[:3]:  # plot up to 3 segments
                    vals = [segment_summary[c][f] for f in radar_feats if f in segment_summary[c]]
                    if vals:  # skip if no values
                        fig.add_trace(go.Scatterpolar(
                            r=vals + [vals[0]],
                            theta=radar_feats + [radar_feats[0]],
                            fill='toself',
                            name=f"Segment {c}"
                        ), row=2, col=1)


            # 4. Distribution histogram
            if customer_segments and features:
                df_cust = pd.DataFrame(customer_segments)
                # pick the first feature name that exists in df_cust
                feat_col = next((col for col in df_cust.columns if str(features[0]) in str(col)), None)
                if feat_col:
                    fig.add_trace(go.Histogram(
                        x=df_cust[feat_col], nbinsx=20
                    ), row=2, col=2)


            fig.update_layout(
                title="Enhanced Customer Segmentation Analysis",
                height=800,
                showlegend=True
            )
            return ComprehensiveVisualizationGenerator._save_chart(fig, filename)


        except Exception as e:
            print(f"Error creating enhanced customer segmentation chart: {e}")
            return None, None


    @staticmethod
    def _create_anomaly_detection_chart(analysis_result: Dict[str, Any], filename: str) -> Tuple[Optional[str], Optional[str]]:
        """Create enhanced anomaly detection visualization - IMPROVED VERSION"""
        try:
            anomaly_stats = analysis_result.get('anomaly_stats', {})
            anomalies_data = analysis_result.get('anomalies', [])
            columns_analyzed = anomaly_stats.get('columns_analyzed', [])
            
            if not anomaly_stats or not anomalies_data:
                return None, None
            
            # Convert anomalies data to DataFrame for easier manipulation
            df_anomalies = pd.DataFrame(anomalies_data)
            
            if len(columns_analyzed) >= 2:
                # Create scatter plot with anomalies highlighted
                x_col, y_col = columns_analyzed[0], columns_analyzed[1]
                
                fig = make_subplots(
                    rows=2, cols=2,
                    subplot_titles=(
                        f'Anomalies: {x_col} vs {y_col}',
                        'Anomaly Scores Distribution',
                        'Anomalies by Column',
                        'Anomaly Statistics'
                    ),
                    specs=[[{"type": "scatter"}, {"type": "histogram"}],
                           [{"type": "box"}, {"type": "bar"}]]
                )
                
                # 1. Scatter plot with anomalies highlighted
                normal_data = df_anomalies[df_anomalies['anomaly'] == 1]
                anomaly_data = df_anomalies[df_anomalies['anomaly'] == -1]
                
                # Normal points
                fig.add_trace(go.Scatter(
                    x=normal_data[x_col],
                    y=normal_data[y_col],
                    mode='markers',
                    marker=dict(color='blue', size=4, opacity=0.6),
                    name='Normal Data',
                    showlegend=True
                ), row=1, col=1)
                
                # Anomaly points
                fig.add_trace(go.Scatter(
                    x=anomaly_data[x_col],
                    y=anomaly_data[y_col],
                    mode='markers',
                    marker=dict(color='red', size=8, symbol='x', opacity=0.8),
                    name='Anomalies',
                    showlegend=True
                ), row=1, col=1)
                
                # 2. Anomaly scores distribution
                fig.add_trace(go.Histogram(
                    x=df_anomalies['anomaly_score'],
                    nbinsx=30,
                    marker=dict(color='orange', opacity=0.7),
                    name='Anomaly Scores',
                    showlegend=False
                ), row=1, col=2)
                
                # 3. Box plots for each column
                for col in columns_analyzed[:3]:  # Limit to 3 columns
                    fig.add_trace(go.Box(
                        y=df_anomalies[col],
                        name=col,
                        showlegend=False
                    ), row=2, col=1)
                
                # 4. Statistics bar chart
                fig.add_trace(go.Bar(
                    x=['Normal', 'Anomalies'],
                    y=[100 - anomaly_stats.get('anomaly_percentage', 0), 
                       anomaly_stats.get('anomaly_percentage', 0)],
                    marker=dict(color=['green', 'red']),
                    name='Distribution %',
                    showlegend=False
                ), row=2, col=2)
                
                fig.update_layout(
                    title=f"Anomaly Detection Analysis ({anomaly_stats.get('total_anomalies', 0)} anomalies found)",
                    height=800,
                    showlegend=True
                )
                
            else:
                # Fallback: Single column analysis
                col = columns_analyzed[0] if columns_analyzed else 'value'
                
                fig = make_subplots(
                    rows=1, cols=2,
                    subplot_titles=(f'Anomalies in {col}', 'Anomaly Score Distribution')
                )
                
                # Time series-like plot with anomalies
                normal_data = df_anomalies[df_anomalies['anomaly'] == 1]
                anomaly_data = df_anomalies[df_anomalies['anomaly'] == -1]
                
                # Plot normal data as line
                fig.add_trace(go.Scatter(
                    x=normal_data.index,
                    y=normal_data[col],
                    mode='lines+markers',
                    marker=dict(color='blue', size=3),
                    line=dict(color='blue', width=1),
                    name='Normal Data'
                ), row=1, col=1)
                
                # Highlight anomalies
                fig.add_trace(go.Scatter(
                    x=anomaly_data.index,
                    y=anomaly_data[col],
                    mode='markers',
                    marker=dict(color='red', size=10, symbol='x'),
                    name='Anomalies'
                ), row=1, col=1)
                
                fig.add_trace(go.Histogram(
                    x=df_anomalies['anomaly_score'],
                    marker=dict(color='orange'),
                    name='Anomaly Scores',
                    showlegend=False
                ), row=1, col=2)
                
                fig.update_layout(
                    title=f"Anomaly Detection: {anomaly_stats.get('total_anomalies', 0)} anomalies found",
                    height=500
                )
            
            return ComprehensiveVisualizationGenerator._save_chart(fig, filename)
            
        except Exception as e:
            print(f"Error creating enhanced anomaly detection chart: {str(e)}")
            return None, None
    


    @staticmethod
    def _save_chart(fig, filename: str) -> Tuple[Optional[str], Optional[str]]:
        """Save chart to file with error handling. Returns (png_path, html_path)"""
        try:
            os.makedirs('charts', exist_ok=True)
            os.makedirs('charts_html', exist_ok=True)
            
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            png_path = f'charts/{filename}_{timestamp}.png'
            html_path = f'charts_html/{filename}_{timestamp}.html'
            
            # Try to save PNG
            try:
                fig.write_image(png_path, width=1400, height=1000, scale=2)
            except Exception as e:
                print(f"  PNG save failed for {filename}: {str(e)}")
                png_path = None
            
            # Try to save HTML
            try:
                fig.write_html(html_path)
            except Exception as e:
                print(f"  HTML save failed for {filename}: {str(e)}")
                html_path = None
            
            return png_path, html_path
        except Exception as e:
            print(f"Warning: Could not save chart {filename}: {str(e)}")
            return None, None
