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
import { toast } from '@/components/ui/use-toast'
import { pluginSourcesSupported } from '@/lib/platform'
import { t } from '@/i18n'

const CATALOG_URL_META_KEY = 'catalog-url'
/** 内置音源（网易云 / QQ）首启自动安装的一次性标记（N1KO 2026-09-03 的产品要求） */
const BUILTIN_SEEDED_META_KEY = 'builtin-seeded'
const BUILTIN_PLUGIN_IDS = ['netease', 'qqmusic']

/** 开发态默认目录由 Vite 中间件供给；正式版默认空（用户自填） */
/**
 * 出厂插件目录。
 *
 * 开发态指向 Vite 中间件直读仓库里的 plugins/；正式版指向随包打进 dist 的
 * `/plugins/catalog.json`（见 vite.config.ts n1koBundlePlugins）——同源、离线可用、
 * 与 App 版本严格一致。为什么不指向 GitHub raw：国内网络时通时不通，
 * 首启种子只跑一次，拉不到就等于装好的 App 里一个音源都没有。
 * `VITE_PLUGIN_CATALOG_URL` 可整体覆盖，留给自托管的人。
 */
function defaultCatalogUrl(): string {
  if (import.meta.env.DEV) return '/__n1ko_plugins/catalog.json'
  const override = import.meta.env.VITE_PLUGIN_CATALOG_URL as string | undefined
  if (override) return override
  return '/plugins/catalog.json'
}

/**
 * 「内置」的判定：这个地址是不是落在出厂目录**所在的目录树**里。
 *
 * 只看 id 不行——用户把目录地址换成第三方站点之后，那边完全可以放一个
 * 同样叫 netease 的条目，于是「内置音源静默自动更新」就成了一条无声的
 * 出网白名单扩容通道：新版 manifest 里多写几个 hosts，下次启动就生效，
 * 全程没有任何提示。
 *
 * 也不能只比 origin：正式版的出厂目录在 raw.githubusercontent.com 上，
 * 那个 origin 下住着 GitHub 上所有仓库——按 origin 判等于把任何人的仓库
 * 都当成出厂。所以比的是「出厂目录文件所在目录」这个前缀：开发态是
 * `/__n1ko_plugins/`，正式版是随包的 `/plugins/`。
 */
function isFactoryUrl(url: string | undefined): boolean {
  const factory = defaultCatalogUrl()
  if (!factory || !url) return false
  try {
    const base = typeof location !== 'undefined' ? location.href : undefined
    const scope = new URL('./', new URL(factory, base)).href
    const target = new URL(url, base).href
    return target.startsWith(scope)
  } catch {
    return false
  }
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

/**
 * 已经拉取并校验、但**还没落库**的一次安装（PROTOCOL §9 的「先 diff 再提交」）。
 *
 * 拆成两步是因为 hosts 扩容必须在写盘之前就能看见：合成一步的话，
 * 「这次更新新增了哪些可访问域名」只能等装完再告诉用户，而那时候
 * 新的白名单已经生效了，确认与否都没有意义。
 */
export interface PendingInstall {
  manifestUrl: string
  manifest: PluginManifest
  code: string
  codeHash: string
  /** 相对已安装版本新增的 hosts；非空表示这次更新扩大了出网范围 */
  addedHosts: string[]
  /** 已安装的版本（首装时没有） */
  currentVersion?: string
}

/** 自动更新因 hosts 扩容而扣下的一条更新，等用户在音源设置里确认 */
export interface HeldUpdate {
  id: string
  name: string
  currentVersion: string
  nextVersion: string
  manifestUrl: string
  addedHosts: string[]
}

interface PluginStoreState {
  plugins: InstalledPluginSummary[]
  catalogUrl: string
  loaded: boolean
  installing: string | null
  /** 自动更新扣下的、等人确认的更新（hosts 有新增） */
  heldUpdates: HeldUpdate[]
  /** 首启内置安装（网易云 / QQ）：load 里触发，幂等（meta 标记） */
  seedBuiltins: () => Promise<void>
  /** 内置音源自动更新：hosts 无新增时静默升级（load 里触发） */
  autoUpdateBuiltins: () => Promise<void>
  /** 拉取 + 校验 + 与已安装版本 diff，不写盘（提交见 commitInstall） */
  prepareInstall: (manifestUrl: string) => Promise<{ ok: true; pending: PendingInstall } | { ok: false; error: string }>
  /** 把 prepareInstall 的结果落库 */
  commitInstall: (pending: PendingInstall) => Promise<{ ok: true } | { ok: false; error: string }>
  /** prepare + commit 一步走（无需确认的路径用）；带回「hosts 较上一版有新增」 */
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
  heldUpdates: [],

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
       出厂目录不可达（离线首启）时单项失败不阻塞，下次启动不再种——
       用户可在音源设置里手动从目录安装。 */
    /* 纯浏览器正式版没有出网通道（见 pluginSourcesSupported）：不种、不更，
       否则用户会看到两个登录后只会报网络错误的音源 */
    if (!pluginSourcesSupported) return
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
    const { catalogUrl } = get()
    /* 只对出厂目录做静默更新（见 isFactoryUrl）：用户自填的目录哪怕
       条目 id 叫 netease 也不算内置，必须走手动确认 */
    if (!catalogUrl || !isFactoryUrl(catalogUrl)) return
    try {
      const catalog = await fetchCatalog(catalogUrl)
      const held: HeldUpdate[] = []
      for (const entry of catalog.entries) {
        const installed = get().plugins.find(p => p.id === entry.id)
        if (!installed || !entry.version || entry.version === installed.version) continue
        // 装的时候就来自出厂目录，才算内置
        if (!isFactoryUrl(installed.sourceUrl)) continue
        const manifestUrl = resolveManifestUrl(catalog.baseUrl, entry)
        if (!isFactoryUrl(manifestUrl)) continue

        const prepared = await get().prepareInstall(manifestUrl)
        if (!prepared.ok) continue
        if (prepared.pending.addedHosts.length) {
          /* hosts 扩容一律扣下等人确认（PROTOCOL §9）。静默放行的话，
             一次自动更新就能把插件的可访问域名加到任意主机上，而这条
             更新链路整个跑在后台、用户全程看不见。 */
          held.push({
            id: entry.id,
            name: installed.name,
            currentVersion: installed.version,
            nextVersion: entry.version,
            manifestUrl,
            addedHosts: prepared.pending.addedHosts,
          })
          /* 扣下之后必须说一声：音源设置在登录墙后面，不提示的话用户会
             一直停在旧版上，还完全不知道有一版在等他确认 */
          toast({
            title: t('sources.settings.updateHeldToast', { name: installed.name, version: entry.version }),
          })
          continue
        }
        const committed = await get().commitInstall(prepared.pending)
        if (committed.ok) {
          /* 后台换掉了用户正在用的代码，至少要说一声版本变了 */
          toast({
            title: t('sources.settings.autoUpdated', { name: installed.name, version: entry.version }),
          })
        }
      }
      set({ heldUpdates: held })
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

  prepareInstall: async (manifestUrl) => {
    try {
      set({ installing: manifestUrl })
      const rawManifest = await fetchInstallJson(manifestUrl)
      const manifest = validateManifest(rawManifest)

      const codeUrl = new URL(manifest.entry, new URL(manifestUrl, location.href).href).href
      const code = await fetchInstallText(codeUrl)
      const codeHash = await sha256Hex(code)

      const prev = await readPlugin(manifest.id)
      const prevManifest = prev ? (prev.manifest as unknown as PluginManifest) : undefined
      // 首装没有「上一版」可比，不算扩容
      const addedHosts = prevManifest
        ? manifest.hosts.filter(h => !prevManifest.hosts.includes(h))
        : []

      return {
        ok: true,
        pending: {
          manifestUrl,
          manifest,
          code,
          codeHash,
          addedHosts,
          ...(prevManifest ? { currentVersion: prevManifest.version } : {}),
        },
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      set({ installing: null })
    }
  },

  commitInstall: async (pending) => {
    try {
      await writePlugin({
        manifest: pending.manifest as unknown as StoredPlugin['manifest'],
        code: pending.code,
        codeHash: pending.codeHash,
        installedAt: Date.now(),
        sourceUrl: pending.manifestUrl,
      })
      const stored = await readAllPlugins()
      set({
        plugins: stored.map(toSummary),
        // 装上了就不再是「待确认」
        heldUpdates: get().heldUpdates.filter(h => h.id !== pending.manifest.id),
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  install: async (manifestUrl) => {
    const prepared = await get().prepareInstall(manifestUrl)
    if (!prepared.ok) return prepared
    const committed = await get().commitInstall(prepared.pending)
    if (!committed.ok) return committed
    return { ok: true, hostsAdded: prepared.pending.addedHosts.length > 0 }
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
    set({
      plugins: stored.map(toSummary),
      heldUpdates: get().heldUpdates.filter(h => h.id !== id),
    })
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
