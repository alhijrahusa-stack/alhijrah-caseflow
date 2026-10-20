"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  /** Short name of the isolated region, reported with the error and shown to staff. */
  name: string;
  /** Rendered instead of the default notice. `null` hides a decorative region silently. */
  fallback?: ReactNode;
  children: ReactNode;
};

type State = { failed: boolean };

/**
 * Isolates one region of a page. A render error inside it replaces that region
 * with a compact notice and a retry, and leaves every sibling region running.
 */
export class SectionBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      event: "section_render_failed",
      section: this.props.name,
      message: error.message,
      component_stack: info.componentStack?.split("\n").slice(0, 6).join("\n") ?? null,
    }));
  }

  private retry = () => {
    this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div role="alert" className="ops-error flex flex-wrap items-center justify-between gap-3" data-testid="section-boundary" data-section={this.props.name}>
        <span>This section could not be displayed. The rest of the page is working.</span>
        <button type="button" className="ops-secondary-button" onClick={this.retry}>Try again</button>
      </div>
    );
  }
}
