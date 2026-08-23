import { Component, ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in React Component Tree:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-slate-800 border border-slate-700/80 rounded-xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-amber-400">
              <AlertTriangle className="w-8 h-8 flex-shrink-0" />
              <h2 className="text-xl font-bold">系统捕获到前端异常</h2>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">
              组件渲染过程中遭遇未知异常。这不影响底层 API 与数据库状态，您可以尝试刷新恢复视图。
            </p>
            {this.state.error && (
              <div className="bg-slate-950 p-3 rounded-lg text-xs font-mono text-red-300 overflow-x-auto border border-red-900/40">
                {this.state.error.toString()}
              </div>
            )}
            <button
              onClick={this.handleReset}
              className="w-full flex items-center justify-center space-x-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 px-4 rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>重新加载工作台</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
