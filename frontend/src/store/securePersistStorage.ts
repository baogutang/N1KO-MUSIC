/**
 * 把持久化内容里的敏感字段加密后再落盘。
 *
 * 只包一层：读写仍然走 createPersistStorage（同步写、防抖、配额回收那一套都保留），
 * 这里只负责在写之前把指定字段封起来、在读之后打开。
 *
 * 读取是异步的（Web Crypto 只有异步接口），zustand v4 的 persist 支持异步 storage：
 * 它会先用初始 state 渲染，解密完成后再 rehydrate。因此调用方必须等
 * `useServerStore.persist.hasHydrated()` 为真再判断「有没有登录」，
 * 否则会在解密完成前误判成未登录并跳去登录页。
 */

import type { PersistStorage, StorageValue } from 'zustand/middleware'
import { createPersistStorage } from '@/store/persistStorage'
import { openText, sealText, type SealedText } from '@/services/deviceKey'

/** 密文字段的外形，用它把「已加密」和「历史遗留的明文」区分开 */
interface SealedField {
  __sealed: SealedText
}

function isSealed(value: unknown): value is SealedField {
  return !!value
    && typeof value === 'object'
    && '__sealed' in value
    && typeof (value as SealedField).__sealed?.data === 'string'
}

/**
 * 描述哪些字段要加密。
 *
 * 用「取出 / 放回」的一对函数而不是字段路径字符串：路径字符串在数组嵌套下
 * 很快就会变成一门小语言，而这里只有一个形状要处理。
 */
export interface SecureFieldSpec<T> {
  /** 取出所有需要加密的明文，返回 [标识, 明文] 列表 */
  collect: (state: T) => Array<[string, string]>
  /** 把（解密后的）明文写回 state */
  apply: (state: T, values: Map<string, string>) => T
}

export function createSecurePersistStorage<T>(
  spec: SecureFieldSpec<T>
): PersistStorage<T> {
  const inner = createPersistStorage<Record<string, unknown>>({ debounceMs: 0 })
  /**
   * 上一次封好的密文，连同它对应的明文指纹。
   *
   * 每次加密都会换一个新的 iv，密文因此每次都不一样；若不缓存，底层适配器的
   * 「内容没变就不写盘」判断会永远失效，凭据没动也会一遍遍重新加密重新写。
   */
  let lastPlainSignature: string | null = null
  let lastSealedMap: Record<string, SealedField> = {}

  return {
    getItem: async name => {
      const stored = await inner.getItem(name)
      if (!stored) return null
      const raw = stored as StorageValue<Record<string, unknown>>
      const sealedMap = raw.state?.__secure as Record<string, unknown> | undefined
      const state = { ...raw.state } as Record<string, unknown>
      delete state.__secure

      if (!sealedMap) {
        // 升级前写下的明文：原样读回来，下一次 setItem 会把它加密重写
        return { ...raw, state: state as T } as StorageValue<T>
      }

      const opened = new Map<string, string>()
      for (const [id, value] of Object.entries(sealedMap)) {
        if (!isSealed(value)) continue
        const plain = await openText(value.__sealed)
        // 解不开就当这条凭据不存在——用户重登一次即可，不能白屏
        if (plain !== null) opened.set(id, plain)
      }
      return { ...raw, state: spec.apply(state as T, opened) } as StorageValue<T>
    },

    setItem: async (name, value) => {
      const entries = spec.collect(value.state)
      const blanks = new Map<string, string>()
      for (const [id, plain] of entries) if (plain) blanks.set(id, '')

      const signature = JSON.stringify(entries)
      let sealedMap: Record<string, SealedField>
      let anySealed: boolean

      if (signature === lastPlainSignature) {
        sealedMap = lastSealedMap
        anySealed = Object.keys(sealedMap).length > 0
      } else {
        sealedMap = {}
        anySealed = false
        for (const [id, plain] of entries) {
          if (!plain) continue
          const sealed = await sealText(plain)
          if (!sealed) continue
          sealedMap[id] = { __sealed: sealed }
          anySealed = true
        }
        lastPlainSignature = signature
        lastSealedMap = sealedMap
      }

      // 设备密钥不可用（无痕模式等）时退回明文：能用比不能用重要，
      // deviceKey 已经把原因打到控制台了。
      // 但插件凭据（网易云/QQ 的完整 Cookie）不在此列——明文落盘的 blast radius
      // 是整个流媒体账号，宁可让用户下次重扫码。
      if (!anySealed && entries.some(([, plain]) => plain)) {
        const sanitized = JSON.parse(JSON.stringify(value.state)) as {
          servers?: Array<Record<string, unknown>>
        }
        let droppedCredentials = false
        for (const server of sanitized.servers ?? []) {
          if (server.credentials !== undefined) {
            delete server.credentials
            droppedCredentials = true
          }
        }
        if (droppedCredentials) {
          console.warn('[securePersistStorage] deviceKey unavailable: plugin credentials NOT persisted in plaintext fallback')
        }
        return inner.setItem(name, { ...value, state: sanitized } as StorageValue<Record<string, unknown>>)
      }

      const scrubbed = spec.apply(value.state, blanks) as unknown as Record<string, unknown>
      return inner.setItem(name, {
        ...value,
        state: { ...scrubbed, __secure: sealedMap },
      } as StorageValue<Record<string, unknown>>)
    },

    removeItem: name => inner.removeItem(name),
  }
}
