/**
 * 插件设置（PLAN 1.6 + 2.6）：已安装插件的管理与安装入口 + 播放优先级。
 * 版本 / 账号 / 状态 / 更新 / 重新登录 / 请求日志 / 卸载、目录安装、
 * URL 与粘贴安装、插件目录地址。视觉沿用 settings/primitives。
 *
 * 这一节管的是插件**代码**与播放顺序；音源本身（NAS 与插件同列、设主库、
 * 移除）在设置页的「音源」一节里。此前两处都能设主库——一个带确认对话框、
 * 一个是无声生效的下拉——同一个有代价的动作有两种不同的后果，
 * 用户没法预期点下去会发生什么。主库入口现在只剩「音源」那一节的按钮。
 */

import { useCallback, useEffect, useState } from 'react'
import { describeError } from '@/services/errors'
import { pluginErrorCode } from '@/services/errors'
import { useNavigate } from 'react-router-dom'
import {
  ArrowsClockwise, CaretDown, CaretRight, SignIn, Trash, DownloadSimple,
  ArrowUp, ArrowDown, ArrowsCounterClockwise,
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { pluginSourcesSupported } from '@/lib/platform'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Row, Section, fieldInputClass, rowClass } from '@/components/settings/primitives'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { useT } from '@/i18n'
import { toast } from '@/components/ui/use-toast'
import { useServerStore } from '@/store/serverStore'
import { useSettingsStore } from '@/store/settingsStore'
import {
  defaultPriorityOrder,
  resolveSourceOrder,
  useConnectedSources,
} from '@/hooks/useSourceQueries'
import {
  usePluginStore,
  type InstalledPluginSummary,
  type PendingInstall,
} from '@/plugins/host/pluginStore'
import { getPluginHost } from '@/plugins/host/pluginRuntime'
import { reloginPath } from '@/components/layout/ConnectionBanner'
import { getAdapterFor, hasAdapterFor } from '@/api'
import type { CatalogEntry } from '@/plugins/host/catalog'

export function SourcesSettings() {
  const { t } = useT()
  const navigate = useNavigate()
  const servers = useServerStore(s => s.servers)
  /** 沙箱越界被强制停用的音源（PluginHost 自拆 → serverStore 置位） */
  const compromisedServerIds = useServerStore(s => s.compromisedServerIds)
  const sources = useConnectedSources()
  const playbackPriority = useSettingsStore(s => s.playbackPriority)
  const setPlaybackPriority = useSettingsStore(s => s.setPlaybackPriority)
  const ordered = resolveSourceOrder(sources, playbackPriority)
  const priorityCustomized = playbackPriority.length > 0

  const plugins = usePluginStore(s => s.plugins)
  const heldUpdates = usePluginStore(s => s.heldUpdates)
  const catalogUrl = usePluginStore(s => s.catalogUrl)
  const load = usePluginStore(s => s.load)
  const install = usePluginStore(s => s.install)
  const prepareInstall = usePluginStore(s => s.prepareInstall)
  const commitInstall = usePluginStore(s => s.commitInstall)
  const installFromCatalog = usePluginStore(s => s.installFromCatalog)
  const installPasted = usePluginStore(s => s.installPasted)
  const uninstall = usePluginStore(s => s.uninstall)
  const checkUpdates = usePluginStore(s => s.checkUpdates)
  const setCatalogUrl = usePluginStore(s => s.setCatalogUrl)
  const getInstalled = usePluginStore(s => s.getInstalled)

  const [catalogEntries, setCatalogEntries] = useState<CatalogEntry[] | null>(null)
  const [catalogBusy, setCatalogBusy] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [urlBusy, setUrlBusy] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteManifest, setPasteManifest] = useState('')
  const [pasteCode, setPasteCode] = useState('')
  const [pasteBusy, setPasteBusy] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
  /** hosts 有新增的更新：先摆出新增域名让用户确认，确认后才落库 */
  const [pendingUpdate, setPendingUpdate] = useState<{ pending: PendingInstall; nextVersion: string } | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [openLogs, setOpenLogs] = useState<string | null>(null)
  const [openCatalog, setOpenCatalog] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  /** 插件 → 已连接的账号（音源） */
  const accountsOf = useCallback(
    (pluginId: string) => servers.filter(s => s.type === 'plugin' && s.pluginId === pluginId),
    [servers]
  )

  /*
   * 阶段 2.3：音源行自己也要能看出「登录过期」，而不是只有顶部横幅在说。
   * 打开设置页时对各插件账号各问一次 diagnose（要打真实登录接口，只问一遍，
   * 不轮询——常驻探测是横幅的职责）。
   */
  const [authExpiredIds, setAuthExpiredIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const bad = new Set<string>()
      for (const server of servers) {
        if (server.type !== 'plugin' || !hasAdapterFor(server.id)) continue
        const adapter = getAdapterFor(server.id)
        if (!adapter.diagnose) continue
        try {
          if ((await adapter.diagnose()) === 'unauthorized') bad.add(server.id)
        } catch (err) {
          if (pluginErrorCode(err) === 'unauthorized') bad.add(server.id)
        }
      }
      if (!cancelled) setAuthExpiredIds(bad)
    })().catch(() => {
      // 探测本身失败（沙箱未 ready 等）不算任何账号过期——静默，下一轮再探
    })
    return () => { cancelled = true }
  }, [servers])

  const doInstallFromCatalog = async (id: string) => {
    setCatalogBusy(true)
    try {
      const result = await installFromCatalog(id)
      if (result.ok) {
        toast({ title: t('sources.settings.installed') })
        setOpenCatalog(false)
      } else {
        toast({ title: t('sources.settings.installFailed'), description: result.error, variant: 'destructive' })
      }
    } finally {
      setCatalogBusy(false)
    }
  }

  const doInstallFromUrl = async () => {
    const url = urlInput.trim()
    if (!url || urlBusy) return
    setUrlBusy(true)
    try {
      const result = await install(url)
      if (result.ok) {
        toast({
          title: t('sources.settings.installed'),
          description: result.hostsAdded ? t('sources.settings.hostsAdded') : undefined,
        })
        setUrlInput('')
      } else {
        toast({ title: t('sources.settings.installFailed'), description: result.error, variant: 'destructive' })
      }
    } finally {
      setUrlBusy(false)
    }
  }

  const doInstallPasted = async () => {
    if (pasteBusy || !pasteManifest.trim() || !pasteCode.trim()) return
    setPasteBusy(true)
    try {
      const result = await installPasted(pasteManifest.trim(), pasteCode.trim())
      if (result.ok) {
        toast({ title: t('sources.settings.installed') })
        setPasteOpen(false)
        setPasteManifest('')
        setPasteCode('')
      } else {
        toast({ title: t('sources.settings.installFailed'), description: result.error, variant: 'destructive' })
      }
    } finally {
      setPasteBusy(false)
    }
  }

  /**
   * 手动更新：先拉取 + diff，hosts 有新增就停在确认这一步。
   * 一步装完再提示的话，用户看到「新增了域名」时新白名单已经生效了。
   */
  const doUpdate = async (plugin: InstalledPluginSummary) => {
    if (updateBusy) return
    setPendingUpdate(null)
    /* 断网不再伪装成「已是最新」（阶段 2.3）；busy 全程生效，防连点 */
    setUpdateBusy(true)
    try {
    const updates = await checkUpdates().catch(() => null)
    if (updates === null) {
      toast({ title: t('sources.settings.catalogFailed'), variant: 'destructive' })
      return
    }
    const candidate = updates.find(u => u.id === plugin.id)
    if (!candidate) {
      toast({ title: t('sources.settings.upToDate') })
      return
    }
    const prepared = await prepareInstall(candidate.manifestUrl)
    if (!prepared.ok) {
      toast({ title: t('sources.settings.installFailed'), description: prepared.error, variant: 'destructive' })
      return
    }
    if (prepared.pending.addedHosts.length > 0) {
      setPendingUpdate({ pending: prepared.pending, nextVersion: candidate.nextVersion })
      return
    }
    await applyUpdate(prepared.pending, candidate.nextVersion)
     } finally {
      setUpdateBusy(false)
    }
  }

  const applyUpdate = async (pending: PendingInstall, nextVersion: string) => {
    setUpdateBusy(true)
    try {
      const result = await commitInstall(pending)
      if (result.ok) {
        setPendingUpdate(null)
        toast({
          title: t('sources.settings.updated', { version: nextVersion }),
          description: pending.addedHosts.length ? t('sources.settings.hostsAdded') : undefined,
        })
      } else {
        toast({ title: t('sources.settings.installFailed'), description: result.error, variant: 'destructive' })
      }
    } finally {
      setUpdateBusy(false)
    }
  }

  const loadCatalog = async () => {
    setCatalogBusy(true)
    try {
      const { fetchCatalog } = await import('@/plugins/host/catalog')
      const catalog = await fetchCatalog(usePluginStore.getState().catalogUrl)
      setCatalogEntries(catalog.entries)
    } catch (err) {
      toast({
        title: t('sources.settings.catalogFailed'),
        description: describeError(err),
        variant: 'destructive',
      })
    } finally {
      setCatalogBusy(false)
    }
  }


  return (
    <Section title={t('sources.settings.title')}>
      {/* 播放优先级（PLAN 2.6；只有一个音源时这一行没有意义，收起）。
          主库不在这里选——它在「音源」那一节，那里的按钮会先说清代价再问 */}
      {sources.length > 1 && (
        <Row name={t('sources.settings.priority')}>
          <div className="flex flex-col items-end gap-1">
            {ordered.map((s, i) => (
              <span key={s.serverId} className="flex items-center gap-2">
                <span className="num w-4 text-right text-[12px] text-ink-faint">{i + 1}</span>
                <SourceBadge serverId={s.serverId} withName />
                <span className="flex items-center">
                  <Button
                    type="button"
                    variant="icon"
                    size="icon-sm"
                    onClick={() => {
                      const ids = ordered.map(x => x.serverId)
                      if (i > 0) { [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]] }
                      // 已断开的源不在列表里但偏好要保住：排在末尾，重连后自动回来
                      setPlaybackPriority([...ids, ...useSettingsStore.getState().playbackPriority.filter(x => !ids.includes(x))])
                    }}
                    disabled={i === 0}
                    aria-label={t('sources.settings.moveUp', { name: s.name })}
                    className="hover:text-primary"
                  >
                    <ArrowUp size={14} />
                  </Button>
                  <Button
                    type="button"
                    variant="icon"
                    size="icon-sm"
                    onClick={() => {
                      const ids = ordered.map(x => x.serverId)
                      if (i < ids.length - 1) { [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]] }
                      setPlaybackPriority([...ids, ...useSettingsStore.getState().playbackPriority.filter(x => !ids.includes(x))])
                    }}
                    disabled={i === ordered.length - 1}
                    aria-label={t('sources.settings.moveDown', { name: s.name })}
                    className="hover:text-primary"
                  >
                    <ArrowDown size={14} />
                  </Button>
                </span>
              </span>
            ))}
            {priorityCustomized ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPlaybackPriority([])}
                className="gap-1 text-[12px] text-ink-faint"
              >
                <ArrowsCounterClockwise size={12} />
                {t('sources.settings.priorityAuto', { default: defaultPriorityOrder(sources).map(s => s.name).join(' → ') })}
              </Button>
            ) : (
              <span className="text-[12px] text-ink-faint">{t('sources.settings.priorityAutoLabel')}</span>
            )}
          </div>
        </Row>
      )}

      {/*
        正式版的纯浏览器没有能带 Cookie 的出网通道（见 lib/platform 的
        pluginSourcesSupported）：装得上、登得进，之后每一次请求都会失败。
        与其给一个注定走不通的安装入口，不如直说这件事需要哪个版本。
      */}
      {!pluginSourcesSupported ? (
        <NeedsAppNotice />
      ) : (
        <>
        {/* 已安装插件 */}
        {plugins.length === 0 && (
          <div className={rowClass}>
            <p className="text-[14px] text-ink-faint">{t('sources.settings.noneInstalled')}</p>
          </div>
        )}
        {plugins.map(plugin => {
          const accounts = accountsOf(plugin.id)
          const logsOpen = openLogs === plugin.id
          const held = heldUpdates.find(h => h.id === plugin.id)
          const compromised = accounts.some(a => compromisedServerIds.includes(a.id))
          const confirming = pendingUpdate?.pending.manifest.id === plugin.id ? pendingUpdate : null
          return (
            <div key={plugin.id} className={cn(rowClass, 'flex-col items-stretch gap-x-0')}>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium">
                    {plugin.name}
                    <span className="num ml-2 text-[12px] font-normal text-ink-faint">v{plugin.version}</span>
                  </p>
                  <div className="num mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-ink-faint">
                    <span>{plugin.platform}</span>
                    <span className={accounts.length > 0 ? 'text-sem-connected' : undefined}>
                      {accounts.length > 0
                        ? t('sources.settings.accounts', { count: accounts.length })
                        : t('sources.settings.noAccount')}
                    </span>
                  </div>
                </div>
                <div className="-mr-2 flex flex-shrink-0 items-center">
                  {/* 检查期间可连点的问题（2.3 / 复核 F25）：除了重入守卫，
                      按钮自己也要按下忙碌态——转圈 + 不可点 */}
                  <IconAction
                    title={updateBusy ? t('sources.settings.checking') : t('sources.settings.update')}
                    onClick={() => void doUpdate(plugin)}
                    disabled={updateBusy}
                  >
                    <ArrowsClockwise size={18} className={updateBusy ? 'animate-spin motion-reduce:animate-none' : undefined} />
                  </IconAction>
                  {/* 直达这个插件的扫码步。此前只是 navigate('/login')：到了登录页
                      点自己那一行，走的是「快速连接」——插件的 connectServer 从不
                      校验凭据，必然成功，人被送回首页，凭据还是坏的。 */}
                  <IconAction
                    title={t('sources.relogin')}
                    onClick={() => navigate(reloginPath(plugin.id))}
                  >
                    <SignIn size={18} />
                  </IconAction>
                  <IconAction title={t('sources.settings.requestLog')} onClick={() => setOpenLogs(logsOpen ? null : plugin.id)}>
                    {logsOpen ? <CaretDown size={18} /> : <CaretRight size={18} />}
                  </IconAction>
                  <IconAction
                    title={t('sources.settings.uninstall')}
                    destructive
                    onClick={() => setPendingRemove(pendingRemove === plugin.id ? null : plugin.id)}
                  >
                    <Trash size={18} />
                  </IconAction>
                </div>
              </div>

              {/* 登录过期：音源行直接说 + 直达扫码步（阶段 2.3 收口） */}
              {accounts.some(a => authExpiredIds.has(a.id)) && (
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-paper-deep px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
                  {t('sources.authExpired')}
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    onClick={() => navigate(reloginPath(plugin.id))}
                  >
                    {t('sources.goRelogin')}
                  </Button>
                </p>
              )}

              {/* 沙箱越界（ready 之后自己导航走）：这个插件的账号已被停用。
                  横幅上说的是同一件事，用户点进设置来要能在这一行看到同样的说明。 */}
              {compromised && (
                <p className="mt-2 rounded-md bg-paper-deep px-3 py-2 text-[13px] leading-relaxed text-sem-error">
                  {t('sources.settings.compromised')}
                </p>
              )}

              {/* 自动更新扣下的更新（hosts 有新增）：明说有一个在等确认 */}
              {held && !confirming && (
                <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
                  {t('sources.settings.updateHeld', { version: held.nextVersion })}
                </p>
              )}

              {/* 出网范围变更确认：把新增的域名摆出来，确认后才落库（PROTOCOL §9） */}
              {confirming && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md bg-paper-deep px-3 py-2.5">
                  <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink-soft">
                    {/* 域名本来就是拉丁串，中英文都用逗号分隔，不必为顿号再开一个词条 */}
                    {t('sources.settings.hostsConfirm', { hosts: confirming.pending.addedHosts.join(', ') })}
                  </p>
                  <div className="flex flex-shrink-0 gap-2">
                    <Button variant="outline" size="sm" disabled={updateBusy} onClick={() => setPendingUpdate(null)}>
                      {t('action.cancel')}
                    </Button>
                    <Button
                      size="sm"
                      disabled={updateBusy}
                      onClick={() => void applyUpdate(confirming.pending, confirming.nextVersion)}
                    >
                      {t('sources.settings.confirmUpdate')}
                    </Button>
                  </div>
                </div>
              )}

              {/* 卸载确认：两击式（删代码 + 凭据 + 私有存储，不可撤销） */}
              {pendingRemove === plugin.id && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md bg-paper-deep px-3 py-2.5">
                  <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink-soft">{t('sources.settings.uninstallConfirm')}</p>
                  <div className="flex flex-shrink-0 gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPendingRemove(null)}>
                      {t('action.cancel')}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        void (async () => {
                          try {
                            await uninstall(plugin.id)
                            setPendingRemove(null)
                            toast({ title: t('sources.settings.uninstalled') })
                          } catch (err) {
                            toast({ title: t('sources.settings.uninstallFailed'), description: describeError(err), variant: 'destructive' })
                          }
                        })()
                      }}
                    >
                      {t('action.remove')}
                    </Button>
                  </div>
                </div>
              )}

              {/* 请求日志：各账号（音源）的沙箱环形缓冲，只含元数据 */}
              {logsOpen && (
                <div className="mt-3 space-y-2">
                  {accounts.length === 0 && (
                    <p className="text-[13px] text-ink-faint">{t('sources.settings.logNoAccount')}</p>
                  )}
                  {accounts.map(account => {
                    const host = getPluginHost(account.id)
                    const logs = [...(host?.requestLogs ?? [])].reverse().slice(0, 8)
                    return (
                      <div key={account.id} className="rounded-md bg-paper-deep">
                        <p className="px-3 pb-1 pt-2 text-[12px] font-medium text-ink-faint">
                          {account.name}
                        </p>
                        {logs.length === 0 ? (
                          <p className="px-3 pb-2 text-[13px] text-ink-faint">{t('sources.settings.logEmpty')}</p>
                        ) : (
                          <ul className="num px-3 pb-2 text-[12px] leading-relaxed text-ink-soft">
                            {logs.map((entry, i) => (
                              <li key={i} className="flex min-w-0 gap-x-3">
                                <span className="flex-shrink-0">{new Date(entry.time).toLocaleTimeString()}</span>
                                <span className="flex-shrink-0">{entry.method} {entry.status}</span>
                                <span className="flex-shrink-0">{entry.durationMs}ms</span>
                                <span className="min-w-0 truncate">{entry.url}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {/* 添加插件：目录 / URL / 粘贴 */}
        <Row name={t('sources.settings.addTitle')} desc={t('sources.settings.addDesc')}>
          <Button
            variant="outline"
            size="sm"
            disabled={!catalogUrl || catalogBusy}
            onClick={() => {
              if (!openCatalog && catalogEntries === null) void loadCatalog()
              setOpenCatalog(v => !v)
            }}
          >
            <DownloadSimple size={14} />
            {t('sources.settings.fromCatalog')}
          </Button>
        </Row>
        {openCatalog && (
          <div className={cn(rowClass, 'flex-col items-stretch gap-x-0 py-2')}>
            {catalogEntries === null ? (
              <p className="py-1 text-[13px] text-ink-faint">{t('sources.settings.catalogLoading')}</p>
            ) : catalogEntries.filter(e => !plugins.some(p => p.id === e.id)).length === 0 ? (
              <p className="py-1 text-[13px] text-ink-faint">{t('sources.settings.catalogAllInstalled')}</p>
            ) : (
              <ul>
                {catalogEntries
                  .filter(e => !plugins.some(p => p.id === e.id))
                  .map(entry => (
                    <li key={entry.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate text-[14px]">{entry.name}</span>
                        <span className="num flex flex-wrap gap-x-3 text-[12px] text-ink-faint">
                          <span>{entry.id}</span>
                          <span>v{entry.version}</span>
                        </span>
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={catalogBusy}
                        onClick={() => void doInstallFromCatalog(entry.id)}
                      >
                        {t('sources.settings.install')}
                      </Button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
        <Row name={t('sources.settings.fromUrl')} desc={t('sources.settings.fromUrlDesc')}>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Input
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              placeholder="https://example.com/plugin/manifest.json"
              className={cn(fieldInputClass, 'w-[240px] max-w-full font-mono text-[12px]')}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <Button variant="outline" size="sm" disabled={urlBusy || !urlInput.trim()} onClick={() => void doInstallFromUrl()}>
              {t('sources.settings.install')}
            </Button>
          </div>
        </Row>
        <div className={cn(rowClass, 'flex-col items-stretch gap-x-0 py-2')}>
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => setPasteOpen(v => !v)}
            className="self-start"
          >
            {t('sources.settings.pasteToggle')}
          </Button>
          {pasteOpen && (
            <div className="mb-1 mt-2 space-y-2">
              <textarea
                value={pasteManifest}
                onChange={e => setPasteManifest(e.target.value)}
                rows={2}
                placeholder={t('sources.settings.pasteManifestPlaceholder')}
                spellCheck={false}
                className={pasteFieldClass}
              />
              <textarea
                value={pasteCode}
                onChange={e => setPasteCode(e.target.value)}
                rows={4}
                placeholder={t('sources.settings.pasteCodePlaceholder')}
                spellCheck={false}
                className={pasteFieldClass}
              />
              <div className="text-right">
                <Button size="sm" disabled={pasteBusy || !pasteManifest.trim() || !pasteCode.trim()} onClick={() => void doInstallPasted()}>
                  {t('sources.settings.install')}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* 插件目录地址（开发态默认本地目录，正式版默认空） */}
        <Row name={t('sources.settings.catalogUrl')} desc={t('sources.settings.catalogUrlDesc')}>
          <CatalogUrlEditor initial={catalogUrl} onSave={url => void setCatalogUrl(url)} />
        </Row>
        </>
      )}
    </Section>
  )
}

/** 粘贴安装的多行输入：下沉底的圆角块，聚焦换纸片底加强调色描边 */
const pasteFieldClass =
  'w-full rounded-md border border-transparent bg-paper-deep px-3 py-2 font-mono text-[12px] text-foreground ' +
  'placeholder:text-ink-faint focus-visible:border-primary focus-visible:bg-sheet focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-primary/20'

/** 发行页：浏览器版里唯一有意义的下一步就是去拿一个带出网通道的壳 */
const RELEASES_URL = 'https://github.com/baogutang/N1KO-MUSIC/releases/latest'

/**
 * 「这需要桌面版 / App」的一行说明 + 下载链接。
 * 登录页有一份同样的文案，但那边刻意不 import 这里：设置页的模块图
 * （插件宿主、目录、请求日志）没有理由被拖进登录页的首屏包。
 */
function NeedsAppNotice() {
  const { t } = useT()
  return (
    <div className={rowClass}>
      <p className="text-[14px] leading-relaxed text-ink-soft">
        {t('sources.needsApp')}{' '}
        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="rounded-sm text-primary underline-offset-4 hover:underline"
        >
          {t('sources.needsAppLink')}
        </a>
      </p>
    </div>
  )
}

function IconAction({
  title,
  destructive,
  disabled,
  onClick,
  children,
}: {
  title: string
  destructive?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="icon"
      size="icon"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cn('h-11 w-11', destructive ? 'hover:text-destructive' : 'hover:text-primary')}
    >
      {children}
    </Button>
  )
}

/** 目录地址编辑：保存后落 IndexedDB，目录列表按新地址重拉 */
function CatalogUrlEditor({
  initial,
  onSave,
}: {
  initial: string
  onSave: (url: string) => void
}) {
  const { t } = useT()
  const [value, setValue] = useState(initial)
  useEffect(() => setValue(initial), [initial])
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Input
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="/__n1ko_plugins/catalog.json"
        className={cn(fieldInputClass, 'w-[240px] max-w-full font-mono text-[12px]')}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <Button variant="outline" size="sm" disabled={value.trim() === initial} onClick={() => { onSave(value.trim()); toast({ title: t('sources.settings.catalogSaved') }) }}>
        {t('action.save')}
      </Button>
    </div>
  )
}
