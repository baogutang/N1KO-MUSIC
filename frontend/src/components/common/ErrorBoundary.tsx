import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message: string
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || t('error.unknown') }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[100dvh] items-center justify-center bg-paper p-6">
          <div className="sheet flex w-full max-w-md flex-col items-center gap-4 px-8 py-10 text-center">
            <h2 className="font-display text-[24px] font-semibold leading-tight text-ink">{t('error.pageTitle')}</h2>
            <p className="max-w-sm break-words text-[15px] leading-relaxed text-ink-faint">{this.state.message}</p>
            <Button className="mt-2" onClick={() => window.location.reload()}>{t('error.reload')}</Button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
