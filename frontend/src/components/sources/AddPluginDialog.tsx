/**
 * 添加插件对话框（PLAN 1.6）：登录页的「添加插件」入口。
 * 三条安装路径：目录（默认开发态本地目录）/ manifest URL / 粘贴文本。
 * 设置页有更全的管理（SourcesSettings）；这里只管装，装完回登录页列表。
 */

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n'
import { toast } from '@/components/ui/use-toast'
import { usePluginStore } from '@/plugins/host/pluginStore'
import { fetchCatalog, type CatalogEntry } from '@/plugins/host/catalog'

export function AddPluginDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useT()
  const plugins = usePluginStore(s => s.plugins)
  const catalogUrl = usePluginStore(s => s.catalogUrl)
  const install = usePluginStore(s => s.install)
  const installFromCatalog = usePluginStore(s => s.installFromCatalog)
  const installPasted = usePluginStore(s => s.installPasted)

  const [entries, setEntries] = useState<CatalogEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [pasteManifest, setPasteManifest] = useState('')
  const [pasteCode, setPasteCode] = useState('')

  useEffect(() => {
    if (!open || entries !== null || !catalogUrl) return
    void (async () => {
      try {
        const catalog = await fetchCatalog(catalogUrl)
        setEntries(catalog.entries)
      } catch {
        setEntries([])
      }
    })()
  }, [open, entries, catalogUrl])

  const doCatalogInstall = async (id: string) => {
    setBusy(true)
    try {
      const result = await installFromCatalog(id)
      if (result.ok) toast({ title: t('sources.settings.installed') })
      else toast({ title: t('sources.settings.installFailed'), description: result.error, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const doUrlInstall = async () => {
    const url = urlInput.trim()
    if (!url || busy) return
    setBusy(true)
    try {
      const result = await install(url)
      if (result.ok) {
        toast({ title: t('sources.settings.installed') })
        setUrlInput('')
      } else {
        toast({ title: t('sources.settings.installFailed'), description: result.error, variant: 'destructive' })
      }
    } finally {
      setBusy(false)
    }
  }

  const doPasteInstall = async () => {
    if (busy || !pasteManifest.trim() || !pasteCode.trim()) return
    setBusy(true)
    try {
      const result = await installPasted(pasteManifest.trim(), pasteCode.trim())
      if (result.ok) {
        toast({ title: t('sources.settings.installed') })
        setPasteManifest('')
        setPasteCode('')
      } else {
        toast({ title: t('sources.settings.installFailed'), description: result.error, variant: 'destructive' })
      }
    } finally {
      setBusy(false)
    }
  }

  const notInstalled = (entries ?? []).filter(e => !plugins.some(p => p.id === e.id))

  const fieldCls =
    'w-full rounded-sm border border-edge/60 bg-fill px-3.5 py-2.5 text-[16px] text-ink placeholder:text-ink-3 hover:border-edge focus-visible:bg-surface regular:text-[14px]'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('sources.settings.addTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* 目录：一组行，行间一个设备像素的线 */}
          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-ink-3">
              {t('sources.settings.fromCatalog')}
            </h3>
            {entries === null ? (
              <p className="text-[14px] text-ink-3">{t('sources.settings.catalogLoading')}</p>
            ) : notInstalled.length === 0 ? (
              <p className="text-[14px] text-ink-3">{t('sources.settings.catalogAllInstalled')}</p>
            ) : (
              <ul className="rounded-lg bg-surface-2">
                {notInstalled.map(entry => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-3 py-2.5 pl-4 pr-2.5 hairline-b last:shadow-none"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-medium text-ink">{entry.name}</span>
                      <span className="num flex flex-wrap gap-x-3 text-[12px] text-ink-3">
                        <span>{entry.id}</span>
                        <span>v{entry.version}</span>
                      </span>
                    </span>
                    <Button variant="secondary" disabled={busy} onClick={() => void doCatalogInstall(entry.id)}>
                      {t('sources.settings.install')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* URL */}
          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-ink-3">
              {t('sources.settings.fromUrl')}
            </h3>
            <div className="flex items-center gap-2">
              <Input
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                placeholder="https://example.com/plugin/manifest.json"
                className="min-w-0 flex-1"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <Button variant="secondary" disabled={busy || !urlInput.trim()} onClick={() => void doUrlInstall()}>
                {t('sources.settings.install')}
              </Button>
            </div>
          </section>

          {/* 粘贴 */}
          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-ink-3">
              {t('sources.settings.pasteToggle')}
            </h3>
            <div className="space-y-2">
              <textarea
                value={pasteManifest}
                onChange={e => setPasteManifest(e.target.value)}
                rows={2}
                placeholder={t('sources.settings.pasteManifestPlaceholder')}
                spellCheck={false}
                className={fieldCls}
              />
              <textarea
                value={pasteCode}
                onChange={e => setPasteCode(e.target.value)}
                rows={3}
                placeholder={t('sources.settings.pasteCodePlaceholder')}
                spellCheck={false}
                className={fieldCls}
              />
              <div className="flex justify-end">
                <Button disabled={busy || !pasteManifest.trim() || !pasteCode.trim()} onClick={() => void doPasteInstall()}>
                  {t('sources.settings.install')}
                </Button>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
