import { Component, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  /** Shown instead of the children once they fail to render. */
  fallback: ReactNode
  children: ReactNode
}

/**
 * Keeps a failing part of a page from taking the whole app down: without a boundary React
 * unmounts everything and the screen goes blank. Give it a `key` to reset it.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error(error)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
