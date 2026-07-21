import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import { queryClient } from './lib/queryClient'
import { useServerStore } from './store/serverStore'
import { useSettingsStore } from './store/settingsStore'

function bothStoresHydrated() {
  return useServerStore.persist.hasHydrated() && useSettingsStore.persist.hasHydrated()
}

/**
 * 启动守卫：等待 zustand persist 从 localStorage 恢复完成后再渲染 App。
 * 注意：不能用 state._hasRehydrated（该字段不在公开 slice 里，会恒为 undefined → 永远黑屏）。
 */
function Bootstrap({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(bothStoresHydrated)

  useEffect(() => {
    if (bothStoresHydrated()) {
      setReady(true)
      return
    }
    const tryReady = () => {
      if (bothStoresHydrated()) setReady(true)
    }
    const unsub1 = useServerStore.persist.onFinishHydration(tryReady)
    const unsub2 = useSettingsStore.persist.onFinishHydration(tryReady)
    tryReady()
    return () => {
      unsub1()
      unsub2()
    }
  }, [])

  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center bg-background" />
  }
  return <>{children}</>
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <Bootstrap>
      <App />
    </Bootstrap>
  </QueryClientProvider>,
)
