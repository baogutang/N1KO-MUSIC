/**
 * 已安装插件的状态与安装 / 更新 / 卸载（PLAN 1.4）。
 *
 * 代码与 manifest 放 IndexedDB（pluginStorage），store 里只持有轻量清单
 * （id / 版本 / 名称 / 来源），避免把几百 KB 的插件代码塞进 zustand。
 * 所有出网取数集中在 installFetch.ts（安装源防线：https 或同源、
 * 内网/回环拒绝、拒 userinfo）；本文件不直接发请求。
 * 凭据永远只走 serverStore 的 securePersistStorage 加密清单；
 * 卸载时按 PROTOCOL §9 清理代码、凭据（连同其 ServerConfig）、私有存储。
 */

import { create } from 'zustand'
import type { PluginManifest } from '../types'
import {
  fetchCatalog,
  resolveManifestUrl,
  sha256Hex,
  validateManifest,
  type UpdateCandidate,
} from './catalog'
import { fetchInstallJson, fetchInstallText } from './installFetch'
import {
  readAllPlugins,
  readPlugin,
  removePlugin,
  writePlugin,
  readMeta,
  writeMeta,
  type StoredPlugin,
} from './pluginStorage'
import { useServerStore } from '@/store/serverStore'

const CATALOG_URL_META_KEY = 'catalog-url'
/** 内置音源（网易云 / QQ）首启自动安装的一次性标记（N1KO 2026-09-03 的产品要求） */
const BUILTIN_SEEDED_META_KEY = 'builtin-seeded'
const BUILTIN_PLUGIN_IDS = ['netease', 'qqmusic']

/** 开发态默认目录由 Vite 中间件供给；正式版默认空（用户自填） */
function defaultCatalogUrl(): string {
  return import.meta.env.DEV ? '/__n1ko_plugins/catalog.json' : ''
}

export interface InstalledPluginSummary {
  id: string
  name: string
  version: string
  platform: string
  installedAt: number
  sourceUrl?: string
  /** manifest 声明的徽标底色（#RRGGBB），可能缺省 */
  color?: string
  codeHash: string
}

interface PluginStoreState {
  plugins: InstalledPluginSummary[]
  catalogUrl: string
  loaded: boolean
  installing: string | null
  /** 首启内置安装（网易云 / QQ）：load 里触发，幂等（meta 标记） */
  seedBuiltins: () => Promise<void>
  /** 内置音源自动更新：hosts 无新增时静默升级（load 里触发） */
  autoUpdateBuiltins: () => Promise<void>
  /** 安装结果里带回「hosts 较上一版有新增」的标记（PROTOCOL §9 更新确认用） */
  install: (manifestUrl: string) => Promise<{ ok: true; hostsAdded: boolean } | { ok: false; error: string }>
  installPasted: (manifestJson: string, code: string) => Promise<{ ok: true } | { ok: false; error: string }>
  installFromCatalog: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>
  uninstall: (id: string) => Promise<void>
  checkUpdates: () => Promise<UpdateCandidate[]>
  setCatalogUrl: (url: string) => Promise<void>
  /** 启动时从 IndexedDB 载入清单（幂等） */
  load: () => Promise<void>
  /** 供 PluginHost 装载沙箱用：读完整安装记录 */
  getInstalled: (id: string) => Promise<StoredPlugin | undefined>
}

export const usePluginStore = create<PluginStoreState>()((set, get) => ({
  plugins: [],
  catalogUrl: '',
  loaded: false,
  installing: null,

  load: async () => {
    const stored = await readAllPlugins()
    const savedUrl = (await readMeta(CATALOG_URL_META_KEY)) as string | undefined
    const seeded = await readMeta(BUILTIN_SEEDED_META_KEY)
    set({
      plugins: stored.map(toSummary),
      catalogUrl: savedUrl ?? defaultCatalogUrl(),
      loaded: true,
    })
    /* 首启内置：网易云 / QQ 自动安装（一次性标记，卸载不复活）。
       正式版默认目录为空 → 静默跳过（无目录可拉）。 */
    if (!seeded && stored.length === 0 && (get().catalogUrl || defaultCatalogUrl())) {
      void get().seedBuiltins()
      return
    }
    /* 内置音源自动更新：官方一等音源不该要求用户去找更新入口
       （设置页在登录墙后面，首启未连服时根本进不去）。
       hosts 有新增时跳过，留给手动更新走确认流程（PROTOCOL §9）。 */
    void get().autoUpdateBuiltins()
  },

  autoUpdateBuiltins: async () => {
    const { catalogUrl, plugins, install } = get()
    if (!catalogUrl) return
    try {
      const catalog = await fetchCatalog(catalogUrl)
      for (const id of BUILTIN_PLUGIN_IDS) {
        const installed = plugins.find(p => p.id === id)
        const entry = catalog.entries.find(e => e.id === id)
        if (!installed || !entry || entry.version === installed.version) continue
        /* 内置音源来自本仓库自己的目录，hosts 扩容（如 netease 补
           *.music.163.com 子域）随更新直接生效——「hosts 有新增留给手动」
           的规则只针对第三方插件；否则设置页在登录墙后，用户会被锁死在
           旧 hosts 上（网易云登录 allowlist 报错的教训） */
        const result = await install(resolveManifestUrl(catalog.baseUrl, entry))
        if (result.ok) {
          set({ plugins: (await readAllPlugins()).map(toSummary) })
        }
      }
    } catch {
      /* 目录不可达：静默跳过，等下次启动 */
    }
  },

  seedBuiltins: async () => {
    const { catalogUrl, installFromCatalog } = get()
    const url = catalogUrl || defaultCatalogUrl()
    if (!url) return
    for (const id of BUILTIN_PLUGIN_IDS) {
      try {
        await installFromCatalog(id)
      } catch {
        /* 目录不可达或单项失败不阻塞其他项 */
      }
    }
    await writeMeta(BUILTIN_SEEDED_META_KEY, Date.now())
  },

  getInstalled: (id) => readPlugin(id),

  install: async (manifestUrl) => {
    try {
      set({ installing: manifestUrl })
      const rawManifest = await fetchInstallJson(manifestUrl)
      const manifest = validateManifest(rawManifest)

      const codeUrl = new URL(manifest.entry, new URL(manifestUrl, location.href).href).href
      const code = await fetchInstallText(codeUrl)
      const codeHash = await sha256Hex(code)

      const prev = await readPlugin(manifest.id)
      const prevHosts = prev ? (prev.manifest as unknown as PluginManifest).hosts : []
      const hostsAdded = !!prev && manifest.hosts.some(h => !prevHosts.includes(h))

      await writePlugin({
        manifest: manifest as unknown as StoredPlugin['manifest'],
        code,
        codeHash,
        installedAt: Date.now(),
        sourceUrl: manifestUrl,
      })
      const stored = await readAllPlugins()
      set({ plugins: stored.map(toSummary) })
      return { ok: true, hostsAdded }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      set({ installing: null })
    }
  },

  installPasted: async (manifestJson, code) => {
    try {
      const manifest = validateManifest(JSON.parse(manifestJson))
      const codeHash = await sha256Hex(code)
      await writePlugin({
        manifest: manifest as unknown as StoredPlugin['manifest'],
        code,
        codeHash,
        installedAt: Date.now(),
      })
      const stored = await readAllPlugins()
      set({ plugins: stored.map(toSummary) })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  installFromCatalog: async (id) => {
    const catalogUrl = get().catalogUrl
    if (!catalogUrl) return { ok: false, error: '未配置插件目录地址' }
    try {
      const catalog = await fetchCatalog(catalogUrl)
      const entry = catalog.entries.find(e => e.id === id)
      if (!entry) return { ok: false, error: `目录里没有 ${id}` }
      const result = await get().install(resolveManifestUrl(catalog.baseUrl, entry))
      return result.ok ? { ok: true } : result
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  uninstall: async (id) => {
    // 1. 断开并移除挂在这个插件上的音源（连同加密凭据）
    const serverState = useServerStore.getState()
    for (const server of serverState.servers.filter(s => s.pluginId === id)) {
      serverState.removeServer(server.id)
    }
    // 2. 删代码与私有 KV
    await removePlugin(id)
    const stored = await readAllPlugins()
    set({ plugins: stored.map(toSummary) })
  },

  checkUpdates: async () => {
    const catalogUrl = get().catalogUrl
    if (!catalogUrl) return []
    const catalog = await fetchCatalog(catalogUrl)
    return diffUpdatesImpl(get().plugins, catalog)
  },

  setCatalogUrl: async (url) => {
    await writeMeta(CATALOG_URL_META_KEY, url)
    set({ catalogUrl: url })
  },
}))

function toSummary(p: StoredPlugin): InstalledPluginSummary {
  const m = p.manifest as unknown as PluginManifest
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    platform: m.platform,
    installedAt: p.installedAt,
    ...(p.sourceUrl ? { sourceUrl: p.sourceUrl } : {}),
    ...(m.color ? { color: m.color } : {}),
    codeHash: p.codeHash,
  }
}

function diffUpdatesImpl(
  plugins: InstalledPluginSummary[],
  catalog: Awaited<ReturnType<typeof fetchCatalog>>
): UpdateCandidate[] {
  const out: UpdateCandidate[] = []
  for (const entry of catalog.entries) {
    const local = plugins.find(p => p.id === entry.id)
    if (!local || !entry.version || entry.version === local.version) continue
    out.push({
      id: entry.id,
      currentVersion: local.version,
      nextVersion: entry.version,
      manifestUrl: resolveManifestUrl(catalog.baseUrl, entry),
    })
  }
  return out
}
