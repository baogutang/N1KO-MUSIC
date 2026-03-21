/**
 * 会员状态管理
 * - 免费用户：仅能使用省流音质，为你推荐/我的收藏/听歌统计菜单置灰
 * - 会员用户：解锁所有功能，默认音质为无损源码
 *
 * 激活流程：用户输入激活码 → activate(code) → 后端验证 → 本地标记 premium
 *
 * 持久化策略：不使用 zustand persist 中间件（该中间件的 subscriber 可能
 * 中断 React 更新链导致 UI 不刷新），改为手动 localStorage 读写：
 *   - 初始化时同步读取 localStorage 作为初始状态
 *   - 每次状态变更后主动写入 localStorage
 *   - subscribe 回调作为兜底自动保存（内置 try-catch 确保不中断 React）
 */

import { create } from 'zustand'
import { useSettingsStore } from './settingsStore'

export type MemberTier = 'free' | 'premium'

export interface MemberState {
  tier: MemberTier
  /** 激活码（已激活后保存，用于重新验证）*/
  activationCode: string
  /** 过期时间（时间戳，-1 表示永久）*/
  expireAt: number
  /** 验证服务器地址（指向 baogutang-music 生产后端）*/
  licenseServerUrl: string
  /** 设备唯一标识（持久化，用于隔离匿名订单）*/
  deviceId: string

  // 计算属性
  isPremium: boolean

  // Actions
  setLicenseServerUrl: (url: string) => void
  /** 激活会员（提交激活码到后端验证）*/
  activate: (code: string) => Promise<{ success: boolean; message: string }>
  /** 注销会员 */
  deactivate: () => void
  /** 检查是否过期，过期自动降级 */
  checkExpiry: () => void
}

/** 生成 UUID v4 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/** baogutang-music 生产环境 */
const DEFAULT_LICENSE_SERVER = 'https://music-search.baogutang.cn:888'

// ─── 手动持久化（不依赖 zustand persist） ──────────────────────────────────────

/** 新的持久化 key（避免与旧的 zustand persist 格式冲突） */
const STORAGE_KEY = 'n1ko-member-activated'
/** 旧的 zustand persist key（兼容读取） */
const OLD_STORAGE_KEY = 'msp-member-store'

interface PersistedData {
  tier: string
  activationCode: string
  expireAt: number
  licenseServerUrl: string
  deviceId: string
}

/** 从 localStorage 读取会员数据（新 key 优先，旧 key 兜底） */
function loadMemberData(): PersistedData | null {
  try {
    // 1. 优先读新 key（直接 JSON 对象）
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const d = JSON.parse(raw) as PersistedData
      if (d && typeof d.tier === 'string') {
        return d
      }
    }
    // 2. 兜底读旧 key（zustand persist 格式：{ state: {...}, version: 0 }）
    const oldRaw = localStorage.getItem(OLD_STORAGE_KEY)
    if (oldRaw) {
      const stored = JSON.parse(oldRaw)
      const s = stored?.state
      if (s && typeof s.tier === 'string') {
        return s as PersistedData
      }
    }
  } catch {
    // localStorage 读取失败，使用默认值
  }
  return null
}

/** 保存会员数据到 localStorage */
function saveMemberData(data: PersistedData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // localStorage 写入失败
  }
}

/** 从当前 store 状态提取需要持久化的数据 */
function extractPersistData(state: MemberState): PersistedData {
  return {
    tier: state.tier,
    activationCode: state.activationCode,
    expireAt: state.expireAt,
    licenseServerUrl: state.licenseServerUrl,
    deviceId: state.deviceId,
  }
}

// ─── 初始化：同步读取 localStorage ─────────────────────────────────────────────

const _saved = loadMemberData()

// ─── Store 定义（不使用 persist 中间件） ────────────────────────────────────────

export const useMemberStore = create<MemberState>()((set, get) => ({
  tier: (_saved?.tier === 'premium' ? 'premium' : 'free') as MemberTier,
  activationCode: _saved?.activationCode ?? '',
  expireAt: _saved?.expireAt ?? 0,
  licenseServerUrl: _saved?.licenseServerUrl ?? DEFAULT_LICENSE_SERVER,
  deviceId: _saved?.deviceId ?? generateUUID(),
  isPremium: _saved?.tier === 'premium',

  setLicenseServerUrl: (url) => {
    set({ licenseServerUrl: url })
    saveMemberData(extractPersistData(get()))
  },

  activate: async (code: string) => {
    const { licenseServerUrl } = get()
    const trimmedCode = code.trim().toUpperCase()
    if (!trimmedCode) {
      return { success: false, message: '请输入激活码' }
    }

    // ── 1. 网络请求（纯 IO，不做任何状态变更）──
    let serverSuccess = false
    let serverMessage = ''
    let serverExpireAt = -1

    try {
      const res = await fetch(`${licenseServerUrl}/api/v1/license/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmedCode }),
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) {
        return { success: false, message: `服务器错误 (${res.status})，请稍后重试` }
      }
      const json = await res.json()
      const inner = (json as { data?: Record<string, unknown> }).data ?? json
      serverSuccess = !!(inner as { success?: boolean }).success
      serverMessage = (inner as { message?: string }).message || ''
      serverExpireAt = (inner as { expireAt?: number }).expireAt ?? -1
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('timeout') || msg.includes('abort')) {
        return { success: false, message: '连接超时，请检查网络后重试' }
      }
      return { success: false, message: '网络异常，请稍后重试' }
    }

    if (!serverSuccess) {
      return { success: false, message: serverMessage || '激活码无效或已被使用' }
    }

    // ── 2. 确定返回值（后续任何异常都不影响这个返回值）──
    const result = {
      success: true,
      message: serverMessage || '激活成功！享受无限音乐体验吧 🎵',
    }

    // ── 3. 更新 store 状态 ──
    try {
      set({
        tier: 'premium' as MemberTier,
        isPremium: true,
        activationCode: trimmedCode,
        expireAt: serverExpireAt,
      })
    } catch {
      // set() 失败不影响返回值
    }

    // ── 4. 立即持久化到 localStorage（不依赖任何中间件） ──
    saveMemberData({
      tier: 'premium',
      activationCode: trimmedCode,
      expireAt: serverExpireAt,
      licenseServerUrl: get().licenseServerUrl,
      deviceId: get().deviceId,
    })

    // ── 5. 切换音质为无损 ──
    try {
      useSettingsStore.getState().setAudioQuality('lossless')
    } catch {
      // 音质切换失败不影响激活结果
    }

    return result
  },

  deactivate: () => {
    try {
      set({
        tier: 'free' as MemberTier,
        isPremium: false,
        activationCode: '',
        expireAt: 0,
      })
    } catch { /* ignore */ }
    saveMemberData(extractPersistData(get()))
    try {
      useSettingsStore.getState().setAudioQuality('low')
    } catch { /* ignore */ }
  },

  checkExpiry: () => {
    const { expireAt, isPremium } = get()
    if (!isPremium) return
    if (expireAt === -1) return  // 永久会员
    if (expireAt > 0 && Date.now() > expireAt) {
      try {
        set({ tier: 'free' as MemberTier, isPremium: false })
      } catch { /* ignore */ }
      saveMemberData(extractPersistData(get()))
    }
  },
}))

// ─── 自动保存订阅（兜底，try-catch 确保不中断 React 更新链） ────────────────────

useMemberStore.subscribe((state) => {
  try {
    saveMemberData(extractPersistData(state))
  } catch {
    // 自动保存失败，不影响运行
  }
})

// 首次启动时保存初始状态（确保 deviceId 等被持久化）
if (!_saved) {
  saveMemberData(extractPersistData(useMemberStore.getState()))
}
