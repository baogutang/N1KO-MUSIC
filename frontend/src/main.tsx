import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import { useServerStore } from './store/serverStore'
import { useSettingsStore } from './store/settingsStore'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30,   // 30 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

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
