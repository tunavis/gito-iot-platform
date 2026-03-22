"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  widgetId?: string;
  widgetTitle?: string;
  onRetry?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      `Widget error${this.props.widgetId ? ` [${this.props.widgetId}]` : ""}:`,
      error,
      errorInfo.componentStack
    );
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", height: "100%", padding: "1rem",
          color: "var(--color-text-secondary, #6b7280)", textAlign: "center",
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p style={{ margin: "0.5rem 0 0.25rem", fontWeight: 500 }}>
            {this.props.widgetTitle
              ? `"${this.props.widgetTitle}" failed to load`
              : "Widget failed to load"}
          </p>
          <p style={{ fontSize: "0.75rem", margin: 0, opacity: 0.7 }}>
            {this.state.error?.message || "An unexpected error occurred"}
          </p>
          <button onClick={this.handleRetry} style={{
            marginTop: "0.75rem", padding: "0.375rem 0.75rem", fontSize: "0.75rem",
            border: "1px solid var(--color-border, #d1d5db)", borderRadius: "0.375rem",
            background: "transparent", color: "inherit", cursor: "pointer",
          }}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
