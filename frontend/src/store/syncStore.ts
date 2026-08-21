/**
 * 同步服务配置与连接状态。
 *
 * 同步是**可选**能力：未配置或未登录时，整个应用行为与从前完全一致，
 * 本地 IndexedDB 仍是收听历史的读取来源。同步只做两件事：
 * 把本地记录镜像到自建后端，以及在新设备上把历史拉回来重建推荐画像。
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createSecurePersistStorage } from '@/store/securePersistStorage'
import { STORAGE_KEYS } from '@/services/storageKeys'
import { t } from '@/i18n'
import {
  checkSyncService,
  describeSyncError,
  loginSyncAccount,
  registerSyncAccount,
} from '@/api/syncClient'

export type SyncStatus = 'disabled' | 'unconfigured' | 'signed-out' | 'connected' | 'error'

/** persist 实际写盘的那一份，storage 适配器按它的形状加解密 */
type PersistedSyncState =
  Pick<SyncState, 'enabled' | 'baseUrl' | 'token' | 'username' | 'lastSyncedAt'>

interface SyncState {
  /** 用户是否开启同步 */
  enabled: boolean
  /** 自建后端地址，例如 http://192.168.1.10:3001 */
  baseUrl: string
  token: string | null
  username: string | null
  /** 最近一次操作的错误提示，供设置页展示 */
  lastError: string | null
  /** 最近一次成功同步的时刻 */
  lastSyncedAt: number | null
  /** 正在进行登录/注册/探测等交互操作 */
  busy: boolean

  setEnabled: (enabled: boolean) => void
  setBaseUrl: (baseUrl: string) => void
  clearError: () => void
  testConnection: () => Promise<boolean>
  signIn: (username: string, password: string) => Promise<boolean>
  signUp: (username: string, password: string) => Promise<boolean>
  signOut: () => void
  markSynced: () => void
  /** 令牌失效（后端返回 401）时清空登录态，避免反复重试 */
  invalidateToken: () => void
}

export const useSyncStore = create<SyncState>()(
  persist(
    (set, get) => ({
      enabled: false,
      baseUrl: '',
      token: null,
      username: null,
      lastError: null,
      lastSyncedAt: null,
      busy: false,

      setEnabled: (enabled) => set({ enabled, lastError: null }),
      setBaseUrl: (baseUrl) => {
        // 换了地址就必须重新登录：令牌只对签发它的那个后端有效
        const changed = baseUrl.trim() !== get().baseUrl
        set({
          baseUrl: baseUrl.trim(),
          lastError: null,
          ...(changed ? { token: null, username: null, lastSyncedAt: null } : {}),
        })
      },
      clearError: () => set({ lastError: null }),

      testConnection: async () => {
        const { baseUrl } = get()
        if (!baseUrl) {
          set({ lastError: t('sync.error.needAddress') })
          return false
        }
        set({ busy: true, lastError: null })
        const result = await checkSyncService(baseUrl)
        set({
          busy: false,
          lastError: result.ok ? null : t('sync.error.unreachableCheck'),
        })
        return result.ok
      },

      signIn: async (username, password) => {
        const { baseUrl } = get()
        if (!baseUrl) {
          set({ lastError: t('sync.error.needAddress') })
          return false
        }
        set({ busy: true, lastError: null })
        try {
          const auth = await loginSyncAccount(baseUrl, username, password)
          set({ token: auth.token, username: auth.username, busy: false, enabled: true })
          return true
        } catch (error) {
          set({ busy: false, lastError: describeSyncError(error) })
          return false
        }
      },

      signUp: async (username, password) => {
        const { baseUrl } = get()
        if (!baseUrl) {
          set({ lastError: t('sync.error.needAddress') })
          return false
        }
        set({ busy: true, lastError: null })
        try {
          const auth = await registerSyncAccount(baseUrl, username, password)
          set({ token: auth.token, username: auth.username, busy: false, enabled: true })
          return true
        } catch (error) {
          set({ busy: false, lastError: describeSyncError(error) })
          return false
        }
      },

      signOut: () => set({ token: null, username: null, lastError: null, lastSyncedAt: null }),
      markSynced: () => set({ lastSyncedAt: Date.now() }),
      invalidateToken: () => set({
        token: null,
        username: null,
        lastError: t('sync.error.expired'),
      }),
    }),
    {
      name: STORAGE_KEYS.syncStore,
      /**
       * 同步后端的 JWT 同样加密落盘。
       *
       * 它是一枚有效期 30 天的令牌，能读写你全部的收听历史、收藏和边注——
       * 和音乐服务器的凭据是同一个量级的东西。只加密后者、把它留在明文里，
       * deviceKey.ts 里「配置目录被拷走 / localStorage 被 dump 就不成立了」
       * 那句话就是假的。
       */
      storage: createSecurePersistStorage<PersistedSyncState>({
        collect: state => (state.token ? [['token', state.token]] : []),
        apply: (state, values) => {
          const token = values.get('token')
          return token === undefined ? state : { ...state, token }
        },
      }) as never,
      partialize: (state) => ({
        enabled: state.enabled,
        baseUrl: state.baseUrl,
        token: state.token,
        username: state.username,
        lastSyncedAt: state.lastSyncedAt,
      }),
    }
  )
)

/** 当前是否可以真正发起同步请求 */
export function syncStatus(state: Pick<SyncState, 'enabled' | 'baseUrl' | 'token'>): SyncStatus {
  if (!state.enabled) return 'disabled'
  if (!state.baseUrl) return 'unconfigured'
  if (!state.token) return 'signed-out'
  return 'connected'
}

/** 取出可用的同步凭据；不可用时返回 null，调用方应静默跳过 */
export function activeSyncCredentials(): { baseUrl: string; token: string } | null {
  const { enabled, baseUrl, token } = useSyncStore.getState()
  if (!enabled || !baseUrl || !token) return null
  return { baseUrl, token }
}
