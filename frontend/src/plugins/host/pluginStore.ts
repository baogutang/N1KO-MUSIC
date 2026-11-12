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
  loadableManifest,
  resolveManifestUrl,
  sha256Hex,
  validateManifest,
  validateStoredManifest,
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
/**
 * 出厂目录是不是**随包**的那一份（不是自托管覆盖、也不是远端地址）。
 *
 * 「hosts 扩容要人确认」防的是**远端目录**：它能在后台悄悄把插件的可访问域名
 * 加到任意主机上。而随包目录就在安装包里，和 App 一起签名分发——用户装这个
 * 版本的时候就已经同意了这份 hosts，再要一次确认只是白挡一道：v1.11.4 给 QQ
 * 加了取流域名，用户装完却发现还是放不了，因为更新被扣在设置页等确认。
 */
function isBundledCatalog(url: string | undefined): boolean {
  if (import.meta.env.DEV) return false
  if (import.meta.env.VITE_PLUGIN_CATALOG_URL) return false
  return !!url && isFactoryUrl(url)
}

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

// ---------------- 安装来源的身份（换来源判定） ----------------

/** 随包插件目录：开发态 Vite 中间件供给的 `/__n1ko_plugins/` 与正式版打进包里的 `/plugins/` */
const BUNDLED_PLUGIN_DIRS = ['/plugins/', '/__n1ko_plugins/']
/**
 * 各个壳的应用源只会落在这两个主机名上：tauri://localhost、http(s)://tauri.localhost、
 * capacitor://localhost（iOS）、https://localhost（Android）、http://localhost:5173（开发态）。
 * 这些主机名在安装源防线里属于内网 / 回环（assertSafeInstallUrl 只放行同源的），
 * 所以盘上记着它们的来源只可能是当时那个壳自己随包的目录。
 */
const APP_SHELL_HOSTNAMES = new Set(['localhost', 'tauri.localhost'])

/** 这个地址是不是某个壳随包的插件目录（不要求与当前壳同源，见 installSourceKey） */
function isBundledPluginUrl(url: string): boolean {
  const base = typeof location !== 'undefined' ? location.href : undefined
  let u: URL
  try {
    u = new URL(url, base)
  } catch {
    return false
  }
  let sameShell = false
  try {
    const here = base ? new URL(base) : null
    // 按 protocol + host 比，不比 origin：自定义 scheme 的 origin 一律序列化成 "null"
    sameShell = !!here && u.host !== '' && u.protocol === here.protocol && u.host === here.host
  } catch {
    sameShell = false
  }
  if (!sameShell && !APP_SHELL_HOSTNAMES.has(u.hostname)) return false
  return BUNDLED_PLUGIN_DIRS.some(dir => u.pathname.startsWith(dir))
}

/**
 * 安装来源的「身份」：比较新旧来源时比的是它，不是原始地址串。
 *
 * - 随包内置（出厂目录树 / 任一壳的随包目录）统一归成一个：应用源在不同壳、
 *   不同版本之间并不一样（tauri://localhost、https://localhost、capacitor://localhost、
 *   开发态 http://localhost:5173 的 `/__n1ko_plugins/` 与正式版的 `/plugins/`），
 *   按原始地址比会把每一次内置升级都判成「换来源」——自动更新就会去清用户的登录。
 * - 粘贴安装没有来源地址，单独一类。
 * - 其余按完整的 manifest 地址（去掉 #片段）比：不能只比 origin——
 *   raw.githubusercontent.com 一个 origin 下住着 GitHub 上所有仓库（同 isFactoryUrl 的理由）。
 *   同一作者挪了 manifest 路径也会被判成换来源，代价只是多一次确认与重新登录。
 */
function installSourceKey(url: unknown): string {
  if (typeof url !== 'string' || !url) return '(pasted)'
  if (isFactoryUrl(url) || isBundledPluginUrl(url)) return '(bundled)'
  try {
    const u = new URL(url, typeof location !== 'undefined' ? location.href : undefined)
    u.hash = ''
    return u.href
  } catch {
    return url
  }
}

/** 两个来源是不是同一个（随包内置之间的升级永远算同一个） */
export function isSameInstallSource(previous: unknown, next: unknown): boolean {
  return installSourceKey(previous) === installSourceKey(next)
}

/** 给人看的来源：随包内置 / 手动粘贴说成一句话，其余给出 manifest 地址本身 */
export function installSourceLabel(url: string | undefined): string {
  const key = installSourceKey(url)
  if (key === '(bundled)') return t('sources.settings.sourceBundled')
  if (key === '(pasted)') return t('sources.settings.sourcePasted')
  return url ?? ''
}

/**
 * 换来源被确认之后：旧来源留下的登录不能交给新代码。
 *
 * 先断开（拆掉在跑的旧沙箱——不拆的话旧代码还能经 env.setCredentials 把刚清掉的
 * 凭据写回来），再把凭据置空；音源行本身留着，用户在原地重新扫码即可。
 * 用的都是 serverStore 现成的公开 action。
 */
function forgetPluginLogins(pluginId: string): void {
  const serverState = useServerStore.getState()
  for (const server of serverState.servers.filter(s => s.pluginId === pluginId)) {
    serverState.disconnectServer(server.id)
    serverState.updateServerCredentials(server.id, null)
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
  /**
   * 同 id 的插件已装、且这次的来源与它记录的来源不是同一个（isSameInstallSource；
   * 随包内置之间的升级不算）。为 true 时只能走带确认的路径，提交时清掉旧来源的登录。
   */
  sourceChanged: boolean
  /** 已装版本记录的来源（manifest 地址）；粘贴安装的没有 */
  previousSourceUrl?: string
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
  /** 供 PluginHost 装载沙箱用：读完整安装记录（manifest 已按读盘规则复验，不合格抛错） */
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
        /* 出厂 → 出厂按设计不会走到这里（两头都归「随包内置」，见 installSourceKey）。
           真走到了说明判定出了岔子：宁可这次不更，也不在后台静默换来源、清用户的登录 */
        if (prepared.pending.sourceChanged) continue
        if (prepared.pending.addedHosts.length && !isBundledCatalog(catalogUrl)) {
          /* hosts 扩容扣下等人确认（PROTOCOL §9）。静默放行的话，一次自动更新
             就能把插件的可访问域名加到任意主机上，而这条更新链路整个跑在后台、
             用户全程看不见。**随包目录除外**——见 isBundledCatalog。 */
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

  getInstalled: async (id) => {
    const record = await readPlugin(id)
    if (!record) return undefined
    /* 读盘复验（沙箱装载、登录页都从这里取）：盘上的记录不是可信输入，
       不合格就抛一条说得清的错，不带病装载（见 catalog.ts 的 validateStoredManifest） */
    loadableManifest(id, record.manifest)
    if (typeof record.code !== 'string') {
      throw new Error(`插件 ${id} 的安装记录不合法，已停止装载；请卸载后重新安装（代码不是文本）`)
    }
    return record
  },

  prepareInstall: async (manifestUrl) => {
    try {
      set({ installing: manifestUrl })
      const rawManifest = await fetchInstallJson(manifestUrl)
      const manifest = validateManifest(rawManifest)

      const codeUrl = new URL(manifest.entry, new URL(manifestUrl, location.href).href).href
      const code = await fetchInstallText(codeUrl)
      const codeHash = await sha256Hex(code)

      const prev = await readPlugin(manifest.id)
      /* 盘上的上一版同样按不可信输入复验：坏掉的记录当作「没有可比的 hosts」，
         这次的 hosts 全部算新增，交给确认流程，而不是在 .includes 上直接抛 */
      let prevManifest: PluginManifest | undefined
      if (prev) {
        try {
          prevManifest = validateStoredManifest(prev.manifest)
        } catch {
          prevManifest = undefined
        }
      }
      // 首装没有「上一版」可比，不算扩容
      const prevHosts = prevManifest?.hosts
      const addedHosts = !prev
        ? []
        : prevHosts
          ? manifest.hosts.filter(h => !prevHosts.includes(h))
          : [...manifest.hosts]
      const previousSourceUrl = prev && typeof prev.sourceUrl === 'string' && prev.sourceUrl ? prev.sourceUrl : undefined
      const sourceChanged = !!prev && !isSameInstallSource(previousSourceUrl, manifestUrl)

      return {
        ok: true,
        pending: {
          manifestUrl,
          manifest,
          code,
          codeHash,
          addedHosts,
          ...(prevManifest ? { currentVersion: prevManifest.version } : {}),
          sourceChanged,
          ...(previousSourceUrl ? { previousSourceUrl } : {}),
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
      const id = pending.manifest.id
      /* 提交那一刻再比一次来源：prepare 与 commit 之间隔着用户确认，盘上可能已经换过 */
      const prev = await readPlugin(id)
      const sourceChanged = pending.sourceChanged || (!!prev && !isSameInstallSource(prev.sourceUrl, pending.manifestUrl))
      if (sourceChanged) {
        /* 换来源 = 当成一个新插件：旧来源留下的登录与私有存储（device-id、匿名
           cookie 之类）都不交给新代码。先清再写——写盘失败时插件处于未安装状态、
           需要重装，也不留一个「新代码 + 旧凭据」的组合 */
        forgetPluginLogins(id)
        await removePlugin(id)
      }
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
    /* 一步装完的路径没有确认环节：换来源一律不在这里替换（否则旧来源的登录
       就无声地交给了新代码），要走 prepareInstall → 设置页确认 → commitInstall */
    if (prepared.pending.sourceChanged) {
      return { ok: false, error: t('sources.settings.sourceChangedNeedsConfirm', { id: prepared.pending.manifest.id }) }
    }
    const committed = await get().commitInstall(prepared.pending)
    if (!committed.ok) return committed
    return { ok: true, hostsAdded: prepared.pending.addedHosts.length > 0 }
  },

  installPasted: async (manifestJson, code) => {
    try {
      const manifest = validateManifest(JSON.parse(manifestJson))
      /* 粘贴的代码没有来源可言：同 id 的插件若来自别处（目录 / URL / 随包），
         直接覆盖就等于让一段来历不明的代码接手它的登录。粘贴入口没有确认环节，
         这里直接拒，请用户先卸载（卸载会连同登录一起清掉）再装 */
      const prev = await readPlugin(manifest.id)
      if (prev && !isSameInstallSource(prev.sourceUrl, undefined)) {
        const name = get().plugins.find(p => p.id === manifest.id)?.name ?? manifest.id
        return {
          ok: false,
          error: t('sources.settings.pasteSourceConflict', { name, from: installSourceLabel(prev.sourceUrl) }),
        }
      }
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

/**
 * 清单里的一行，只做展示。盘上的记录不保证合格：字段逐个按字符串取，
 * 不合格的记录也照样列出来——否则连卸载入口都没有；装载时 getInstalled
 * 会复验并拒绝它。
 */
function toSummary(p: StoredPlugin): InstalledPluginSummary {
  const m: Record<string, unknown> = p.manifest
  const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)
  return {
    id: str(m.id),
    name: str(m.name, str(m.id)),
    version: str(m.version),
    platform: str(m.platform),
    installedAt: p.installedAt,
    ...(typeof p.sourceUrl === 'string' && p.sourceUrl ? { sourceUrl: p.sourceUrl } : {}),
    ...(typeof m.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(m.color) ? { color: m.color } : {}),
    codeHash: str(p.codeHash),
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
