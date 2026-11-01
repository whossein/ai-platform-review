import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /** Short label shown in the fallback, e.g. the view name. */
  readonly label?: string;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

/** Keeps a rendering crash in one view from blanking the whole app. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`UI crashed${this.props.label ? ` in ${this.props.label}` : ""}:`, error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card" style={{ margin: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <strong>Something went wrong{this.props.label ? ` in ${this.props.label}` : ""}.</strong>
        <code style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{this.state.error.message}</code>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn btn-secondary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button className="btn btn-secondary" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
