import React from "react";

type PanelErrorBoundaryProps = {
  editorId: string;
  onRetry?: () => void;
  children: React.ReactNode;
};

type PanelErrorBoundaryState = {
  hasError: boolean;
  errorMessage?: string;
};

export class PanelErrorBoundary extends React.Component<
  PanelErrorBoundaryProps,
  PanelErrorBoundaryState
> {
  state: PanelErrorBoundaryState = {
    hasError: false,
    errorMessage: undefined,
  };

  static getDerivedStateFromError(error: unknown): PanelErrorBoundaryState {
    return {
      hasError: true,
      errorMessage:
        error instanceof Error ? error.message : String(error ?? "Unknown error"),
    };
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error("[panel-error-boundary] Editor failed:", {
      editorId: this.props.editorId,
      error,
      info,
    });
  }

  private handleRetry = () => {
    this.setState({ hasError: false, errorMessage: undefined });
    this.props.onRetry?.();
  };

  override render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: "1rem",
            color: "#f3b3b3",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
          <div>
            <strong>{this.props.editorId}</strong> crashed.
          </div>
          {this.state.errorMessage ? (
            <div style={{ opacity: 0.7, fontSize: "0.85rem" }}>
              {this.state.errorMessage}
            </div>
          ) : null}
          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              alignSelf: "flex-start",
              background: "#1f2933",
              color: "white",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 4,
              padding: "0.3rem 0.6rem",
              cursor: "pointer",
            }}
          >
            Reload editor
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
