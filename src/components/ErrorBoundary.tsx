import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'An unexpected rendering error occurred.',
    };
  }

  override componentDidCatch(error: unknown) {
    console.error('Hazel UI ErrorBoundary caught error:', error);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-[100dvh] w-full items-center justify-center bg-white p-6 text-slate-900 dark:bg-[#131314] dark:text-zinc-100">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-slate-50 p-6 text-center shadow-lg dark:border-zinc-800 dark:bg-[#1B1C1E]">
            <h1 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              Something went wrong
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-zinc-400">
              {this.state.message || 'Hazel encountered an unexpected display issue.'}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 inline-flex min-h-[40px] items-center justify-center rounded-full bg-blue-600 px-5 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
            >
              Reload Hazel
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
