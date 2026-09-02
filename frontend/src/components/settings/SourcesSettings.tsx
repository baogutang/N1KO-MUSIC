/**
 * 音源设置（PLAN 1.6）：已安装插件的管理与安装入口。
 * 版本 / 账号 / 状态 / 更新 / 重新登录 / 请求日志 / 卸载、目录安装、
 * URL 与粘贴安装、插件目录地址。视觉沿用 settings/primitives。
 */

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowsClockwise, CaretDown, CaretRight, SignIn, Trash, DownloadSimple,
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Row, Section } from '@/components/settings/primitives'
import { useT } from '@/i18n'
import { toast } from '@/components/ui/use-toast'
import { useServerStore } from '@/store/serverStore'
import {
  usePluginStore,
  type InstalledPluginSummary,
} from '@/plugins/host/pluginStore'
import { getPluginHost } from '@/plugins/host/pluginRuntime'
import type { CatalogEntry } from '@/plugins/host/catalog'

export function SourcesSettings() {
  const { t } = useT()
  const navigate = useNavigate()
  const servers = useServerStore(s => s.servers)

  const plugins = usePluginStore(s => s.plugins)
  const catalogUrl = usePluginStore(s => s.catalogUrl)
  const load = usePluginStore(s => s.load)
  const install = usePluginStore(s => s.install)
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

  const doUpdate = async (plugin: InstalledPluginSummary) => {
    const updates = await checkUpdates().catch(() => [])
    const candidate = updates.find(u => u.id === plugin.id)
    if (!candidate) {
      toast({ title: t('sources.settings.upToDate') })
      return
    }
    const result = await install(candidate.manifestUrl)
    if (result.ok) {
      toast({
        title: t('sources.settings.updated', { version: candidate.nextVersion }),
        description: result.hostsAdded ? t('sources.settings.hostsAdded') : undefined,
      })
    } else {
      toast({ title: t('sources.settings.installFailed'), description: result.error, variant: 'destructive' })
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
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setCatalogBusy(false)
    }
  }

  return (
    <Section title={t('sources.settings.title')} tag={t('sources.settings.tag')}>
      {/* 已安装插件 */}
      {plugins.length === 0 && (
        <p className="py-4 text-[13px] text-ink-faint">{t('sources.settings.noneInstalled')}</p>
      )}
      {plugins.map(plugin => {
        const accounts = accountsOf(plugin.id)
        const logsOpen = openLogs === plugin.id
        return (
          <div key={plugin.id} className="border-b border-hair-soft py-4">
            <div className="flex items-stretch justify-between gap-4">
              <div className="flex min-w-0 items-stretch gap-3">
                <span className={cn('w-[2px] flex-shrink-0', accounts.length > 0 ? 'bg-primary' : 'bg-transparent')} />
                <div className="min-w-0 py-0.5">
                  <p className="truncate text-sm font-medium">
                    {plugin.name}
                    <span className="num ml-2 text-[11px] font-normal text-ink-faint">v{plugin.version}</span>
                  </p>
                  <p className="num mt-0.5 truncate text-xs text-ink-faint">
                    {plugin.platform}
                    {accounts.length > 0
                      ? ` · ${t('sources.settings.accounts', { count: accounts.length })}`
                      : ` · ${t('sources.settings.noAccount')}`}
                  </p>
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                <IconAction title={t('sources.settings.update')} onClick={() => void doUpdate(plugin)}>
                  <ArrowsClockwise size={15} />
                </IconAction>
                <IconAction title={t('sources.settings.relogin')} onClick={() => navigate('/login')}>
                  <SignIn size={15} />
                </IconAction>
                <IconAction title={t('sources.settings.requestLog')} onClick={() => setOpenLogs(logsOpen ? null : plugin.id)}>
                  {logsOpen ? <CaretDown size={15} /> : <CaretRight size={15} />}
                </IconAction>
                <IconAction
                  title={t('sources.settings.uninstall')}
                  destructive
                  onClick={() => setPendingRemove(pendingRemove === plugin.id ? null : plugin.id)}
                >
                  <Trash size={15} />
                </IconAction>
              </div>
            </div>

            {/* 卸载确认：两击式（删代码 + 凭据 + 私有存储，不可撤销） */}
            {pendingRemove === plugin.id && (
              <div className="mt-3 flex items-center justify-between gap-3 border-l-2 border-destructive bg-paper-deep/40 px-3 py-2">
                <p className="text-[12.5px] leading-relaxed text-ink-soft">{t('sources.settings.uninstallConfirm')}</p>
                <div className="flex flex-shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPendingRemove(null)}>
                    {t('action.cancel')}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      void (async () => {
                        await uninstall(plugin.id)
                        setPendingRemove(null)
                        toast({ title: t('sources.settings.uninstalled') })
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
                  <p className="text-[12px] text-ink-faint">{t('sources.settings.logNoAccount')}</p>
                )}
                {accounts.map(account => {
                  const host = getPluginHost(account.id)
                  const logs = [...(host?.requestLogs ?? [])].reverse().slice(0, 8)
                  return (
                    <div key={account.id} className="border border-hair-soft">
                      <p className="border-b border-hair-soft px-3 py-1.5 text-[11px] tracking-[0.14em] text-ink-faint">
                        {account.name}
                      </p>
                      {logs.length === 0 ? (
                        <p className="px-3 py-2 text-[12px] text-ink-faint">{t('sources.settings.logEmpty')}</p>
                      ) : (
                        <ul className="num px-3 py-2 text-[11.5px] leading-relaxed text-ink-soft">
                          {logs.map((entry, i) => (
                            <li key={i} className="truncate">
                              {new Date(entry.time).toLocaleTimeString()} · {entry.method} {entry.status} · {entry.durationMs}ms · {entry.url}
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
          <DownloadSimple size={14} className="mr-1.5" />
          {t('sources.settings.fromCatalog')}
        </Button>
      </Row>
      {openCatalog && (
        <div className="border-b border-hair-soft py-3">
          {catalogEntries === null ? (
            <p className="text-[12.5px] text-ink-faint">{t('sources.settings.catalogLoading')}</p>
          ) : catalogEntries.filter(e => !plugins.some(p => p.id === e.id)).length === 0 ? (
            <p className="text-[12.5px] text-ink-faint">{t('sources.settings.catalogAllInstalled')}</p>
          ) : (
            <ul>
              {catalogEntries
                .filter(e => !plugins.some(p => p.id === e.id))
                .map(entry => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-[13px]">{entry.name}</span>
                      <span className="num block text-[11px] text-ink-faint">
                        {entry.id} · v{entry.version}
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
        <div className="flex items-center gap-2">
          <Input
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            placeholder="https://example.com/plugin/manifest.json"
            className="w-[240px] font-mono text-[12px]"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <Button variant="outline" size="sm" disabled={urlBusy || !urlInput.trim()} onClick={() => void doInstallFromUrl()}>
            {t('sources.settings.install')}
          </Button>
        </div>
      </Row>
      <div className="border-b border-hair-soft py-3">
        <button
          onClick={() => setPasteOpen(v => !v)}
          className="text-[12.5px] text-ink-soft hover:text-primary transition-colors"
        >
          {t('sources.settings.pasteToggle')}
        </button>
        {pasteOpen && (
          <div className="mt-3 space-y-2">
            <textarea
              value={pasteManifest}
              onChange={e => setPasteManifest(e.target.value)}
              rows={2}
              placeholder={t('sources.settings.pasteManifestPlaceholder')}
              spellCheck={false}
              className="w-full rounded-md border border-hair bg-paper px-3 py-2 font-mono text-[12px] text-foreground placeholder:text-ink-faint/70 focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <textarea
              value={pasteCode}
              onChange={e => setPasteCode(e.target.value)}
              rows={4}
              placeholder={t('sources.settings.pasteCodePlaceholder')}
              spellCheck={false}
              className="w-full rounded-md border border-hair bg-paper px-3 py-2 font-mono text-[12px] text-foreground placeholder:text-ink-faint/70 focus:outline-none focus:ring-1 focus:ring-primary"
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
    </Section>
  )
}

function IconAction({
  title,
  destructive,
  onClick,
  children,
}: {
  title: string
  destructive?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-full text-ink-faint transition-colors active:scale-95',
        destructive ? 'hover:text-destructive' : 'hover:text-primary'
      )}
    >
      {children}
    </button>
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
    <div className="flex items-center gap-2">
      <Input
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="/__n1ko_plugins/catalog.json"
        className="w-[240px] font-mono text-[12px]"
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
