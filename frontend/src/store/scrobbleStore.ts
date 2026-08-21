/**
 * 直连打卡的配置与失败队列。
 *
 * token 存在本地——这是纯前端应用能做到的边界，没有服务端可以替你保管它。
 * 因此界面上只显示尾四位，且它只会被发往用户自己填的那个端点。
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { STORAGE_KEYS } from '@/services/storageKeys'
import {
  LISTENBRAINZ_DEFAULT_URL, trimPending, type ListenPayload,
} from '@/services/listenBrainz'

interface ScrobbleState {
  enabled: boolean
  apiUrl: string
  token: string
  /** 校验通过时记下的用户名，用来在设置页确认连的是哪个账号 */
  userName?: string
  /** 最近一次失败的原因，界面直说而不是默默不动 */
  lastError?: string
  lastSuccessAt?: number
  /** 提交失败、等待重试的记录 */
  pending: ListenPayload[]

  setConfig: (config: Partial<Pick<ScrobbleState, 'enabled' | 'apiUrl' | 'token' | 'userName'>>) => void
  enqueue: (listen: ListenPayload) => void
  /** 取出队列并清空，交给调用方去提交；失败的由 enqueue 放回来 */
  drainPending: () => ListenPayload[]
  noteSuccess: () => void
  noteError: (message: string) => void
  reset: () => void
}

export const useScrobbleStore = create<ScrobbleState>()(
  persist(
    (set, get) => ({
      enabled: false,
      apiUrl: LISTENBRAINZ_DEFAULT_URL,
      token: '',
      pending: [],

      setConfig: config => set(config),

      enqueue: listen => set(state => ({ pending: trimPending([...state.pending, listen]) })),

      drainPending: () => {
        const { pending } = get()
        if (pending.length) set({ pending: [] })
        return pending
      },

      noteSuccess: () => set({ lastSuccessAt: Date.now(), lastError: undefined }),
      noteError: message => set({ lastError: message }),

      reset: () => set({
        enabled: false,
        apiUrl: LISTENBRAINZ_DEFAULT_URL,
        token: '',
        userName: undefined,
        lastError: undefined,
        lastSuccessAt: undefined,
        pending: [],
      }),
    }),
    { name: STORAGE_KEYS.scrobbleStore }
  )
)
