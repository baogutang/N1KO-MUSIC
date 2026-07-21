/**
 * 全局 QueryClient 单例
 * 独立成模块以便 serverStore 在切换服务器时清空缓存
 * （不能放在 main.tsx：serverStore 持久化恢复时会同步调用 activateServer，循环引用会导致 TDZ 错误）
 */

import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30,   // 30 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
