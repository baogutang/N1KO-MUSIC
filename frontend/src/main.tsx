import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import { queryClient } from './lib/queryClient'
import { useServerStore } from './store/serverStore'
import { useSettingsStore } from './store/settingsStore'
import { registerPersistFlushHooks } from './store/persistStorage'
import { runStorageMaintenance } from './services/storageMaintenance'
import { initListeningHistory } from './services/listeningHistory'
import {
  backfillPendingScrobbles,
  pullRemoteHistory,
  startHistorySync,
} from './services/historySync'
import { syncNotes } from './services/notes'
import { useSyncStore } from './store/syncStore'

// 清掉旧版每 30 秒新增一条、从不回收的推荐缓存键：已被撑满配额的用户
// 加载一次即可自愈。（persist 适配器本身也会在写入失败时回收，此处是提前腾空间。）
runStorageMaintenance()
registerPersistFlushHooks()
// 收听历史迁移到 IndexedDB。异步完成，完成后会广播 msp-history-updated，
// 首页/历史页/统计页据此刷新，因此无需阻塞首屏渲染。
startHistorySync()

/**
 * 等 syncStore 从磁盘恢复完成。
 *
 * 它的令牌现在是加密落盘的，恢复因此是异步的（Web Crypto 没有同步接口）。
 * 不等就去发同步请求，读到的 token 还是初始值 null，三件事会一起静默跳过，
 * 而调用方看不出区别——「未配置同步」和「还没读出来」在返回值上长得一模一样。
 */
function whenSyncStoreReady(): Promise<void> {
  if (useSyncStore.persist.hasHydrated()) return Promise.resolve()
  return new Promise(resolve => {
    const unsubscribe = useSyncStore.persist.onFinishHydration(() => {
      unsubscribe()
      resolve()
    })
  })
}

void Promise.all([initListeningHistory(), whenSyncStoreReady()]).then(() => {
  // 上报出队只存在内存里，刷新会丢；补推上次成功同步之后的记录（未配置同步则为空操作）
  backfillPendingScrobbles()
  // 本地历史就绪后再拉远端，合并时才能正确识别哪些是新记录
  void pullRemoteHistory()
  /**
   * 边注对账。
   *
   * 未配置同步后端时是空操作。放在这里而不是每次打开详情页时同步：
   * 边注体量很小，启动对一次账就够，页面上读的永远是本地那份。
   */
  void syncNotes().catch(() => {})
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
