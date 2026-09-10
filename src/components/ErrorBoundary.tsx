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
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 sm:p-6">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-amber-400">
              <AlertTriangle className="w-6 h-6 flex-shrink-0" />
              <h2 className="text-lg sm:text-xl font-bold text-white">系统捕获到前端异常</h2>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              组件渲染过程中遭遇未知异常。这不影响底层 API 与数据库状态，您可以尝试刷新恢复视图。
            </p>
            {this.state.error && (
              <div className="bg-slate-950 p-3.5 rounded-xl text-xs font-mono text-rose-300 overflow-x-auto border border-rose-950/60 leading-relaxed">
                {this.state.error.toString()}
              </div>
            )}
            <button
              onClick={this.handleReset}
              className="w-full flex items-center justify-center space-x-2 bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-950 font-bold py-3 px-4 rounded-xl transition cursor-pointer min-h-[44px] shadow-2xs"
            >
              <RefreshCw className="w-4 h-4 text-slate-800" />
              <span>重新加载工作台</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
