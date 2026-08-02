import React from 'react'

interface State { error: Error | null }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-screen w-full bg-gray-950 flex items-center justify-center p-8">
          <div className="max-w-lg w-full bg-gray-900 border border-red-500/30 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-red-500/20 rounded-full flex items-center justify-center text-red-400 font-bold">!</div>
              <h2 className="text-white font-semibold">Lỗi ứng dụng</h2>
            </div>
            <p className="text-gray-400 text-sm mb-4">Đã xảy ra lỗi. Vui lòng chụp màn hình và gửi cho kỹ thuật.</p>
            <pre className="bg-black rounded-lg p-4 text-red-400 text-xs overflow-auto max-h-48 whitespace-pre-wrap break-all">
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack?.slice(0, 500)}
            </pre>
            <button
              onClick={() => window.location.href = '/'}
              className="mt-4 w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors"
            >
              Về trang chủ
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
