import { Component } from 'react';

/** Catches render errors so one broken view never blanks the app; offers a safe way to recover. */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error, info) {
    // Intentionally console-only: never ship stack traces or user data to third parties from here.
    console.error('UI error boundary caught:', error, info?.componentStack);
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="boundary" role="alert">
        <h1>Something went wrong</h1>
        <p>We hit an unexpected problem displaying this page. Your accounts and data are not affected.</p>
        <div className="boundary-actions">
          <button type="button" className="btn btn-primary btn-md" onClick={() => this.setState({ error: null })}><span>Try again</span></button>
          <a className="btn btn-secondary btn-md" href="/"><span>Go to home</span></a>
        </div>
      </div>
    );
  }
}
