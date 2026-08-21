/**
 * 音乐库范围。
 *
 * 很多人把「音乐」和「有声书 / 播客 / 白噪声」放在不同的 library 里。
 * 全部混在一起时，随机播放和推荐都会被污染——放着放着蹦出一段有声书。
 *
 * 这里保存用户选定的库，并作为所有服务器查询的一部分参与缓存键，
 * 切库等于换一整套缓存，不会串。
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createPersistStorage } from '@/store/persistStorage'
import { STORAGE_KEYS } from '@/services/storageKeys'

interface LibraryScopeState {
  /** serverId → 选中的 musicFolderId；缺省表示全部库 */
  scopes: Record<string, string | undefined>
  getScope: (serverId: string | null) => string | undefined
  setScope: (serverId: string, folderId: string | undefined) => void
}

export const useLibraryScopeStore = create<LibraryScopeState>()(
  persist(
    (set, get) => ({
      scopes: {},
      getScope: (serverId) => (serverId ? get().scopes[serverId] : undefined),
      setScope: (serverId, folderId) =>
        set(state => ({ scopes: { ...state.scopes, [serverId]: folderId } })),
    }),
    {
      name: STORAGE_KEYS.libraryScope,
      // 体积极小且是用户主动选择，同步写入避免丢失
      storage: createPersistStorage({ debounceMs: 0 }),
      partialize: (state) => ({ scopes: state.scopes }),
    }
  )
)
