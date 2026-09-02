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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">{t('sources.settings.addTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* 目录 */}
          <div>
            <p className="mb-2 text-[11px] tracking-[0.18em] text-ink-faint">
              {t('sources.settings.fromCatalog')}
            </p>
            {entries === null ? (
              <p className="text-[12.5px] text-ink-faint">{t('sources.settings.catalogLoading')}</p>
            ) : notInstalled.length === 0 ? (
              <p className="text-[12.5px] text-ink-faint">{t('sources.settings.catalogAllInstalled')}</p>
            ) : (
              <ul className="border-t border-hair">
                {notInstalled.map(entry => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 border-b border-hair-soft py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px]">{entry.name}</span>
                      <span className="num block text-[11px] text-ink-faint">{entry.id} · v{entry.version}</span>
                    </span>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void doCatalogInstall(entry.id)}>
                      {t('sources.settings.install')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* URL */}
          <div>
            <p className="mb-2 text-[11px] tracking-[0.18em] text-ink-faint">
              {t('sources.settings.fromUrl')}
            </p>
            <div className="flex items-center gap-2">
              <Input
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                placeholder="https://example.com/plugin/manifest.json"
                className="font-mono text-[12px]"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <Button variant="outline" size="sm" disabled={busy || !urlInput.trim()} onClick={() => void doUrlInstall()}>
                {t('sources.settings.install')}
              </Button>
            </div>
          </div>

          {/* 粘贴 */}
          <div>
            <p className="mb-2 text-[11px] tracking-[0.18em] text-ink-faint">
              {t('sources.settings.pasteToggle')}
            </p>
            <div className="space-y-2">
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
                rows={3}
                placeholder={t('sources.settings.pasteCodePlaceholder')}
                spellCheck={false}
                className="w-full rounded-md border border-hair bg-paper px-3 py-2 font-mono text-[12px] text-foreground placeholder:text-ink-faint/70 focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="text-right">
                <Button size="sm" disabled={busy || !pasteManifest.trim() || !pasteCode.trim()} onClick={() => void doPasteInstall()}>
                  {t('sources.settings.install')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
