/**
 * 设置页
 * 杂志编辑风（DESIGN v2 §4.4）：衬线分区标题 + 发丝线，选项行式排布
 * （左名称/说明，右控件），开关为细线滑块，输入框为发丝线下缘。
 * 多色 accent 预设与歌词高亮色选择器已随 v2 契约移除（统一朱红 accent）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Trash, CheckCircle, ArrowsClockwise,
  SignOut, CaretRight, WifiHigh,
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { SourcesSettings } from '@/components/settings/SourcesSettings'
import { useServerStore, getServerTypeLabel } from '@/store/serverStore'
import { useThemeStore } from '@/store/themeStore'
import { LOCALES, setLocale, useT } from '@/i18n'
import { usePlayerStore } from '@/store/playerStore'
import {
  useSettingsStore,
  QUALITY_LABEL_KEYS,
  type AudioQuality,
  type CoverShape,
} from '@/store/settingsStore'
import { createAdapter, getAdapter, hasAdapter } from '@/api'
import { useLibraryScan } from '@/hooks/useServerQueries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { toast } from '@/components/ui/use-toast'
import {
  Row,
  Section,
  SubHead,
  Toggle,
  hairInputClass,
} from '@/components/settings/primitives'
import { SyncSettings } from '@/components/settings/SyncSettings'
import { ScrobbleSettings } from '@/components/settings/ScrobbleSettings'
import { importListeningEvents, readListeningEvents } from '@/services/listeningHistory'
import { capImport, parseHistoryFile } from '@/services/historyImport'
import { clearProfileCache } from '@/services/musicbrainz'
import { downloadTextFile, historyToCSV, historyToJSON } from '@/services/playlistFiles'
import pkg from '../../package.json'
import type { ReplayGainMode } from '@/utils/replayGain'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// ─── 子组件 ───────────────────────────────────────────────────────────────────

/** 细线分段控件：hair 边框 + 当前项 accent 文字与 2px 下缘 */
function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-sm border border-hair overflow-hidden divide-x divide-hair-soft pop:rounded-pill pop:divide-x-0 pop:gap-1 pop:p-1 pop:bg-paper-deep pop:shadow-press"
    >
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'seg-option px-3.5 h-8 text-[13px] transition-colors duration-200 pop:rounded-pill pop:font-semibold',
            value === opt.value
              ? 'is-on text-primary font-medium pop:bg-primary pop:text-primary-foreground'
              : 'text-ink-soft hover:text-foreground pop:hover:bg-surface pop:hover:text-foreground'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

/** 端点配置行：左标签，右发丝线输入框 */
const REPLAY_GAIN_OPTIONS: Array<{ value: ReplayGainMode; labelKey: string }> = [
  { value: 'off', labelKey: 'settings.replayGain.off' },
  { value: 'auto', labelKey: 'settings.replayGain.auto' },
  { value: 'track', labelKey: 'settings.replayGain.track' },
  { value: 'album', labelKey: 'settings.replayGain.album' },
]

/** 翻译目标语言：value 是发给自定义 API 的取值，不随界面语言变化 */
const TRANSLATE_LANGS: Array<{ value: string; labelKey: string }> = [
  { value: '英文', labelKey: 'settings.translate.lang.en' },
  { value: '中文', labelKey: 'settings.translate.lang.zh' },
  { value: '日文', labelKey: 'settings.translate.lang.ja' },
  { value: '韩文', labelKey: 'settings.translate.lang.ko' },
  { value: '法文', labelKey: 'settings.translate.lang.fr' },
  { value: '德文', labelKey: 'settings.translate.lang.de' },
]

/** 翻译类型：同上，value 是接口取值 */
const TRANSLATE_TYPES: Array<{ value: string; labelKey: string }> = [
  { value: '无', labelKey: 'settings.translate.type.none' },
  { value: '没有内置翻译', labelKey: 'settings.translate.type.noBuiltin' },
  { value: '不内置', labelKey: 'settings.translate.type.notBuiltin' },
]

function EndpointRow({ label, value, onChange, placeholder, desc }: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  desc?: React.ReactNode
}) {
  return (
    <div className="py-4 border-b border-hair-soft">
      <div className="flex items-center gap-4">
        <p className="text-sm font-medium w-20 flex-shrink-0">{label}</p>
        <Input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={hairInputClass}
        />
      </div>
      {desc && <p className="text-xs text-ink-faint mt-2 pl-24">{desc}</p>}
    </div>
  )
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────

/**
 * 收听历史导出。
 *
 * 自托管的意义就是数据是你的。JSON 完整、可再导入；
 * CSV 给表格和第三方打卡导入工具用。两种都在本机生成。
 */
function DataExportSection() {
  const { t } = useT()
  const serverId = useServerStore(s => s.activeServerId)
  const [count, setCount] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  const refreshCount = useCallback(() => {
    setCount(serverId ? readListeningEvents(serverId).length : 0)
  }, [serverId])

  useEffect(() => { refreshCount() }, [refreshCount])

  /**
   * 导入既有打卡历史。
   *
   * 换到自托管播放器最劝退的一件事，是多年的收听记录留在了别处、新软件从零开始。
   * 那些记录本来就是你的，应该能拿回来。
   */
  const handleImport = async (file: File) => {
    if (!serverId) return
    setImporting(true)
    try {
      const parsed = parseHistoryFile(await file.text(), serverId)
      if (!parsed) {
        toast({
          title: t('settings.import.unknownFile'),
          description: t('settings.import.unknownFileDesc'),
          variant: 'destructive',
        })
        return
      }
      const capped = capImport(parsed)
      const added = await importListeningEvents(capped.events, serverId)
      refreshCount()
      const notes = [
        capped.skipped > 0 ? t('settings.import.skipped', { count: capped.skipped }) : '',
        capped.truncated > 0 ? t('settings.import.truncated', { count: capped.truncated }) : '',
      ].filter(Boolean).join(' · ')
      toast({
        title: t('settings.import.done', { count: added }),
        description: notes || undefined,
      })
    } catch {
      toast({ title: t('settings.import.failed'), variant: 'destructive' })
    } finally {
      setImporting(false)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  const handleExport = (format: 'json' | 'csv') => {
    if (!serverId) return
    const events = readListeningEvents(serverId)
    if (!events.length) {
      toast({ title: t('settings.export.nothing') })
      return
    }
    const stamp = new Date().toISOString().slice(0, 10)
    if (format === 'json') {
      downloadTextFile(
        `n1ko-music-history-${stamp}.json`,
        historyToJSON(events, new Date().toISOString()),
        'application/json'
      )
    } else {
      downloadTextFile(`n1ko-music-history-${stamp}.csv`, historyToCSV(events), 'text/csv')
    }
    toast({ title: t('settings.export.done', { count: events.length }) })
  }

  return (
    <Section title={t('section.yourData')} tag={t('section.yourData.tag')}>
      <div className="flex items-center justify-between gap-6 py-5">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t('settings.export.name')}</p>
          <p className="mt-0.5 text-xs text-ink-faint">
            {count == null
              ? t('settings.export.counting')
              : t('settings.export.desc', { count })}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-5">
          <button
            type="button"
            onClick={() => handleExport('json')}
            className="text-sm font-semibold underline decoration-hair decoration-1 underline-offset-[6px] transition-colors hover:text-primary hover:decoration-primary"
          >
            JSON
          </button>
          <button
            type="button"
            onClick={() => handleExport('csv')}
            className="text-sm text-ink-soft transition-colors hover:text-primary"
          >
            CSV
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-6 py-5">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t('settings.import.name')}</p>
          <p className="mt-0.5 text-xs text-ink-faint">
            {t('settings.import.desc')}
          </p>
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept=".json,.csv,application/json,text/csv"
          className="sr-only"
          onChange={event => {
            const file = event.target.files?.[0]
            if (file) void handleImport(file)
          }}
        />
        <button
          type="button"
          disabled={importing || !serverId}
          onClick={() => importInputRef.current?.click()}
          className="flex-shrink-0 text-sm font-semibold underline decoration-hair decoration-1 underline-offset-[6px] transition-colors hover:text-primary hover:decoration-primary disabled:pointer-events-none disabled:opacity-40"
        >
          {importing ? t('settings.import.busy') : t('action.chooseFile')}
        </button>
      </div>
    </Section>
  )
}

export default function Settings() {
  const navigate = useNavigate()
  const { servers, activeServerId, activateServer, removeServer, disconnect } = useServerStore()
  const { theme, setTheme, skin, setSkin } = useThemeStore()
  const { t, locale } = useT()
  const volume    = usePlayerStore(s => s.volume)
  const setVolume = usePlayerStore(s => s.setVolume)
  const {
    apiPreferServer, apiAuthToken,
    coverRemoteTemplate, coverLoadAlbum, coverLoadArtist, coverShape,
    lyricsRemoteTemplate, lyricsConfirmTemplate, lyricsUseRemote, lyricsPreferRemote, lyricsFontSize,
    songDetailTemplate, songDetailPathReplace,
    translateTargetLang, translateType,
    audioQuality, cellularAudioQuality, adaptiveQuality,
    replayGainMode, replayGainPreamp,
    playbackRate, smoothTransitions, preloadNext, autoContinueQueue,
    notificationActions, seekStepSeconds, resumeAfterInterruption, musicBrainzEnabled,
    setApiPreferServer, setApiAuthToken,
    setCoverRemoteTemplate, setCoverLoadAlbum, setCoverLoadArtist, setCoverShape,
    setLyricsRemoteTemplate, setLyricsConfirmTemplate, setLyricsUseRemote, setLyricsPreferRemote, setLyricsFontSize,
    setSongDetailTemplate, setSongDetailPathReplace,
    setTranslateTargetLang, setTranslateType,
    setAudioQuality, setCellularAudioQuality, setAdaptiveQuality,
    setReplayGainMode, setReplayGainPreamp,
    setPlaybackRate, setSmoothTransitions, setPreloadNext, setAutoContinueQueue,
    setNotificationActions, setSeekStepSeconds, setResumeAfterInterruption, setMusicBrainzEnabled,
  } = useSettingsStore()
  const [pinging, setPinging] = useState<string | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  // 删除服务器会连同 URL、用户名与令牌一起永久抹掉且无法撤销，必须二次确认
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
  const scan = useLibraryScan()
  // 能力探测：不支持的服务器上整个入口不出现，而不是点了没反应
  const supportsScan = hasAdapter() && typeof getAdapter().startScan === 'function'

  const activeServer = servers.find(s => s.id === activeServerId)

  async function handlePing(serverId: string) {
    const server = servers.find(s => s.id === serverId)
    if (!server) return
    setPinging(serverId)
    try {
      // 用被点击行的服务器配置临时创建适配器，而不是 ping 当前激活的服务器
      const adapter = createAdapter(server)
      const ok = await adapter.ping()
      toast({
        title: ok ? t('settings.server.pingOk') : t('settings.server.pingFail'),
        variant: ok ? 'default' : 'destructive',
      })
    } catch {
      toast({ title: t('settings.server.pingError'), variant: 'destructive' })
    } finally {
      setPinging(null)
    }
  }

  async function handleSwitch(id: string) {
    if (!(await activateServer(id))) {
      toast({
        title: t('settings.server.reloginTitle'),
        description: t('settings.server.reloginDesc'),
        variant: 'destructive',
      })
      return
    }
    toast({ title: t('settings.server.switched') })
  }

  function handleRemove(id: string) {
    if (id === activeServerId) {
      disconnect()
      navigate('/login')
    }
    removeServer(id)
    toast({ title: t('settings.server.removed') })
  }

  function handleDisconnect() {
    disconnect()
    navigate('/login')
  }

  return (
    <div className="min-h-full pt-9 pb-8 animate-fade-in">
      <div className="max-w-[720px]">
        {/* 报头 */}
        <header>
          <p className="text-[11px] tracking-[0.3em] text-ink-faint mb-2">{t('settings.preferences.tag')}</p>
          <h1 className="font-serif text-4xl font-bold tracking-tight">{t('nav.settings')}</h1>
        </header>

        {/* 服务器管理 */}
        <Section title={t('settings.servers')} tag={t('settings.servers.tag')}>
          <div>
            {servers.map(server => (
              <div
                key={server.id}
                className="flex items-stretch justify-between gap-4 py-4 border-b border-hair-soft"
              >
                <div className="flex items-stretch gap-3 min-w-0">
                  {/* 当前服务器：accent 左竖线 */}
                  <span className={cn('w-[2px] flex-shrink-0', server.id === activeServerId ? 'bg-primary' : 'bg-transparent')} />
                  <div className="min-w-0 py-0.5">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{server.name}</p>
                      {server.id === activeServerId && (
                        <span className="text-[11px] text-primary flex items-center gap-1 flex-shrink-0">
                          <CheckCircle weight="fill" className="w-3 h-3" />
                          {t('settings.server.current')}
                        </span>
                      )}
                    </div>
                    <p className="num text-xs text-ink-faint truncate mt-0.5">{server.url}</p>
                    <p className="text-xs text-ink-faint">{getServerTypeLabel(server.type)} · {server.username}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => handlePing(server.id)}
                    disabled={pinging === server.id}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-ink-faint hover:text-foreground transition-colors duration-200 active:scale-95"
                    title={t('settings.server.ping')}
                    aria-label={t('settings.server.pingAria', { name: server.name })}
                  >
                    {pinging === server.id
                      ? <ArrowsClockwise className="w-4 h-4 animate-spin" />
                      : <WifiHigh className="w-4 h-4" />
                    }
                  </button>
                  {server.id !== activeServerId && (
                    <button
                      type="button"
                      onClick={() => handleSwitch(server.id)}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-ink-faint hover:text-primary transition-colors duration-200 active:scale-95"
                      title={t('settings.server.switch')}
                      aria-label={t('settings.server.switchAria', { name: server.name })}
                    >
                      <CaretRight className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPendingRemove(server.id)}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-ink-faint hover:text-destructive transition-colors duration-200 active:scale-95"
                    title={t('settings.server.remove')}
                    aria-label={t('settings.server.removeAria', { name: server.name })}
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}

            {supportsScan && (
              <Row
                name={t('settings.scan.name')}
                desc={t('settings.scan.desc')}
              >
                <button
                  onClick={() => scan.mutate()}
                  disabled={scan.isPending}
                  className="act-secondary inline-flex items-center gap-2 rounded border border-hair px-3.5 py-1.5 text-[13px] text-ink-soft transition-colors duration-200 hover:border-ink hover:text-ink disabled:opacity-50"
                >
                  <ArrowsClockwise size={13} className={scan.isPending ? 'animate-spin' : undefined} />
                  {scan.isPending ? t('settings.scan.busy') : t('settings.scan.start')}
                </button>
              </Row>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/login')}
              className="mt-5 gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              {t('settings.server.add')}
            </Button>
          </div>
        </Section>

        {/* 音源（插件）：安装 / 更新 / 卸载 / 请求日志 / 目录地址 */}
        <SourcesSettings />

        {/* 界面语言 */}
        <Section title={t('settings.language')} tag={t('settings.language.tag')}>
          <Row
            name={t('settings.language.display')}
            desc={t('settings.language.displayDesc')}
          >
            <Segmented
              label={t('settings.language.display')}
              value={locale}
              onChange={setLocale}
              options={LOCALES.map(item => ({ value: item.value, label: item.label }))}
            />
          </Row>
        </Section>

        {/* 外观 */}
        <Section title={t('settings.appearance')} tag={t('settings.appearance.tag')}>
          {/*
            皮肤排在明暗之上：它决定的是整套设计语言（形状、字体、动效），
            明暗只是同一张皮的两个档位。
          */}
          <Row
            name={t('settings.skin.name')}
            desc={
              <>
                {t('settings.skin.desc')}
                <br />
                <span className="text-ink-soft">
                  {skin === 'pop' ? t('settings.skin.popDesc') : t('settings.skin.editorialDesc')}
                </span>
              </>
            }
          >
            <Segmented
              label={t('settings.skin.name')}
              value={skin}
              onChange={setSkin}
              options={[
                { value: 'pop' as const, label: t('settings.skin.pop') },
                { value: 'editorial' as const, label: t('settings.skin.editorial') },
              ]}
            />
          </Row>
          <Row name={t('settings.theme.name')} desc={t('settings.theme.desc')}>
            <Segmented
              label={t('settings.theme.name')}
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'dark', label: t('settings.theme.dark') },
                { value: 'light', label: t('settings.theme.light') },
                { value: 'system', label: t('settings.theme.system') },
              ]}
            />
          </Row>
          <Row name={t('settings.coverShape.name')} desc={t('settings.coverShape.desc')}>
            <Segmented
              label={t('settings.coverShape.label')}
              value={coverShape}
              onChange={(v) => setCoverShape(v as CoverShape)}
              options={[
                { value: 'square', label: t('settings.coverShape.square') },
                { value: 'circle', label: t('settings.coverShape.circle') },
              ]}
            />
          </Row>
        </Section>

        {/* 音频 */}
        <Section title={t('settings.audio')} tag={t('settings.audio.tag')}>
          <Row name={t('settings.volume.name')}>
            <div className="flex items-center gap-3 w-60">
              <Slider
                value={[volume]}
                min={0}
                max={1}
                step={0.01}
                onValueChange={([v]) => setVolume(v)}
                aria-label={t('settings.volume.name')}
                className="flex-1"
              />
              <span className="num text-xs text-ink-soft w-9 text-right">
                {Math.round(volume * 100)}%
              </span>
            </div>
          </Row>
          <div className="py-4 border-b border-hair-soft">
            <p className="text-sm font-medium">{t('settings.quality.wifi')}</p>
            <p className="text-xs text-ink-faint mt-0.5">
              {t('settings.quality.desc')}
            </p>
            <div role="radiogroup" aria-label={t('settings.quality.wifiAria')} className="mt-2">
              {(Object.keys(QUALITY_LABEL_KEYS) as AudioQuality[]).map(q => (
                <button
                  key={q}
                  type="button"
                  role="radio"
                  aria-checked={audioQuality === q}
                  onClick={() => setAudioQuality(q)}
                  className="group w-full flex items-center gap-3 py-2.5 text-left"
                >
                  <span
                    className={cn(
                      'w-3 h-3 rounded-full border flex-shrink-0 transition-colors duration-200',
                      audioQuality === q
                        ? 'border-primary bg-primary'
                        : 'border-hair group-hover:border-ink-faint'
                    )}
                  />
                  <span
                    className={cn(
                      'text-sm transition-colors duration-200',
                      audioQuality === q ? 'text-primary' : 'text-ink-soft group-hover:text-foreground'
                    )}
                  >
                    {t(QUALITY_LABEL_KEYS[q])}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <Row
            name={t('settings.adaptiveQuality.name')}
            desc={t('settings.adaptiveQuality.desc')}
          >
            <Toggle checked={adaptiveQuality} onChange={setAdaptiveQuality} label={t('settings.adaptiveQuality.name')} />
          </Row>

          {adaptiveQuality && (
            <div className="py-4 border-b border-hair-soft">
              <p className="text-sm font-medium">{t('settings.quality.cellular')}</p>
              <p className="text-xs text-ink-faint mt-0.5">
                {t('settings.quality.cellularDesc')}
              </p>
              <div role="radiogroup" aria-label={t('settings.quality.cellularAria')} className="mt-2">
                {(Object.keys(QUALITY_LABEL_KEYS) as AudioQuality[]).map(q => (
                  <button
                    key={q}
                    type="button"
                    role="radio"
                    aria-checked={cellularAudioQuality === q}
                    onClick={() => setCellularAudioQuality(q)}
                    className="group w-full flex items-center gap-3 py-2.5 text-left"
                  >
                    <span
                      className={cn(
                        'w-3 h-3 rounded-full border flex-shrink-0 transition-colors duration-200',
                        cellularAudioQuality === q
                          ? 'border-primary bg-primary'
                          : 'border-hair group-hover:border-ink-faint'
                      )}
                    />
                    <span
                      className={cn(
                        'text-sm transition-colors duration-200',
                        cellularAudioQuality === q
                          ? 'text-primary'
                          : 'text-ink-soft group-hover:text-foreground'
                      )}
                    >
                      {t(QUALITY_LABEL_KEYS[q])}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="py-4 border-b border-hair-soft">
            <p className="text-sm font-medium">{t('settings.replayGain.name')}</p>
            <p className="text-xs text-ink-faint mt-0.5 max-w-[52ch]">
              {t('settings.replayGain.desc')}
            </p>
            <div role="radiogroup" aria-label={t('settings.replayGain.label')} className="mt-2 flex flex-wrap gap-x-7 gap-y-1">
              {REPLAY_GAIN_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={replayGainMode === opt.value}
                  onClick={() => setReplayGainMode(opt.value)}
                  className="group flex items-center gap-2.5 py-2 text-left"
                >
                  <span
                    className={cn(
                      'w-3 h-3 rounded-full border flex-shrink-0 transition-colors duration-200',
                      replayGainMode === opt.value
                        ? 'border-primary bg-primary'
                        : 'border-hair group-hover:border-ink-faint'
                    )}
                  />
                  <span
                    className={cn(
                      'text-sm transition-colors duration-200',
                      replayGainMode === opt.value
                        ? 'text-primary'
                        : 'text-ink-soft group-hover:text-foreground'
                    )}
                  >
                    {t(opt.labelKey)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {replayGainMode !== 'off' && (
            <Row name={t('settings.preamp.name')} desc={t('settings.preamp.desc')}>
              <div className="flex items-center gap-3 w-60">
                <Slider
                  value={[replayGainPreamp]}
                  min={-15}
                  max={15}
                  step={0.5}
                  onValueChange={([v]) => setReplayGainPreamp(v)}
                  aria-label={t('settings.preamp.name')}
                  aria-valuetext={t('settings.preamp.valueText', {
                    value: `${replayGainPreamp > 0 ? '+' : ''}${replayGainPreamp}`,
                  })}
                  className="flex-1"
                />
                <span className="num text-xs text-ink-soft w-12 text-right">
                  {replayGainPreamp > 0 ? '+' : ''}{replayGainPreamp} dB
                </span>
              </div>
            </Row>
          )}

          <Row name={t('settings.playbackRate.name')} desc={t('settings.playbackRate.desc')}>
            <div className="flex items-center gap-3 w-60">
              <Slider
                value={[playbackRate]}
                min={0.5}
                max={3}
                step={0.05}
                onValueChange={([v]) => setPlaybackRate(v)}
                aria-label={t('settings.playbackRate.name')}
                aria-valuetext={t('settings.playbackRate.valueText', { rate: playbackRate.toFixed(2) })}
                className="flex-1"
              />
              <span className="num text-xs text-ink-soft w-12 text-right">
                {playbackRate.toFixed(2)}×
              </span>
            </div>
          </Row>

          <Row name={t('settings.preload.name')} desc={t('settings.preload.desc')}>
            <Toggle checked={preloadNext} onChange={setPreloadNext} label={t('settings.preload.name')} />
          </Row>

          <Row name={t('settings.autoContinue.name')} desc={t('settings.autoContinue.desc')}>
            <Toggle checked={autoContinueQueue} onChange={setAutoContinueQueue} label={t('settings.autoContinue.name')} />
          </Row>

          <Row
            name={t('settings.notificationActions.name')}
            desc={t('settings.notificationActions.desc')}
          >
            <Segmented
              label={t('settings.notificationActions.name')}
              value={notificationActions}
              onChange={setNotificationActions}
              options={[
                { value: 'track', label: t('settings.notificationActions.track') },
                { value: 'seek', label: t('settings.notificationActions.seek') },
                { value: 'both', label: t('settings.notificationActions.both') },
              ]}
            />
          </Row>
          {notificationActions !== 'track' && (
            <Row name={t('settings.seekStep.name')} desc={t('settings.seekStep.desc')}>
              <div className="flex items-center gap-3">
                <Slider
                  value={[seekStepSeconds]}
                  min={5}
                  max={60}
                  step={5}
                  onValueChange={([v]) => setSeekStepSeconds(v)}
                  className="w-[140px]"
                />
                <span className="font-num w-10 text-right text-sm">{seekStepSeconds}s</span>
              </div>
            </Row>
          )}
          <Row
            name={t('player.carMode')}
            desc={t('settings.carMode.desc')}
          >
            <button
              type="button"
              onClick={() => usePlayerStore.getState().setCarMode(true)}
              className="text-sm font-semibold underline decoration-hair decoration-1 underline-offset-[6px] transition-colors hover:text-primary hover:decoration-primary"
            >
              {t('settings.carMode.enter')}
            </button>
          </Row>
          <Row
            name={t('settings.resume.name')}
            desc={t('settings.resume.desc')}
          >
            <Toggle
              checked={resumeAfterInterruption}
              onChange={setResumeAfterInterruption}
              label={t('settings.resume.name')}
            />
          </Row>
          <Row name={t('settings.smooth.name')} desc={t('settings.smooth.desc')}>
            <Toggle checked={smoothTransitions} onChange={setSmoothTransitions} label={t('settings.smooth.name')} />
          </Row>
        </Section>

        {/* 自定义 API */}
        <Section title={t('settings.customApi')} tag={t('settings.customApi.tag')}>
          <Row name={t('settings.api.preferServer')} desc={t('settings.api.preferServerDesc')}>
            <Toggle label={t('settings.api.preferServer')} checked={apiPreferServer} onChange={setApiPreferServer} />
          </Row>

          <EndpointRow
            label={t('settings.api.authToken')}
            value={apiAuthToken}
            onChange={setApiAuthToken}
            placeholder="Authorization Token"
            desc={(
              <>
                {t('settings.api.authTokenDesc1')}
                <code className="num text-ink-soft border border-hair-soft rounded-sm px-1 mx-1">Authorization</code>
                {t('settings.api.authTokenDesc2')}
              </>
            )}
          />

          <SubHead title={t('settings.api.lyrics')} />
          <EndpointRow
            label={t('settings.api.url')}
            value={lyricsRemoteTemplate}
            onChange={setLyricsRemoteTemplate}
            placeholder="https://lrcapi.example.com/api?title={title}&artist={artist}"
          />

          <SubHead title={t('settings.api.lyricsConfirm')} />
          <EndpointRow
            label={t('settings.api.url')}
            value={lyricsConfirmTemplate}
            onChange={setLyricsConfirmTemplate}
            placeholder="https://lrcapi.example.com/confirm"
          />

          <SubHead title={t('settings.api.cover')} />
          <EndpointRow
            label={t('settings.api.url')}
            value={coverRemoteTemplate}
            onChange={setCoverRemoteTemplate}
            placeholder="https://api.example.com/cover?artist={artist}&album={album}"
          />
          <Row name={t('settings.api.loadAlbumCover')}>
            <Toggle label={t('settings.api.loadAlbumCover')} checked={coverLoadAlbum} onChange={setCoverLoadAlbum} />
          </Row>
          <Row name={t('settings.api.loadArtistImage')}>
            <Toggle label={t('settings.api.loadArtistImage')} checked={coverLoadArtist} onChange={setCoverLoadArtist} />
          </Row>

          <SubHead title={t('settings.api.songDetail')} />
          <EndpointRow
            label={t('settings.api.url')}
            value={songDetailTemplate}
            onChange={setSongDetailTemplate}
            placeholder="https://example.com/songs"
          />
          <EndpointRow
            label={t('settings.api.pathReplace')}
            value={songDetailPathReplace}
            onChange={setSongDetailPathReplace}
            placeholder="pattern,replacement"
            desc={t('settings.api.pathReplaceDesc')}
          />

          <SubHead title={t('settings.api.translate')} />
          <Row name={t('settings.translate.targetLang')}>
            <select
              value={translateTargetLang}
              onChange={e => setTranslateTargetLang(e.target.value)}
              aria-label={t('settings.translate.targetLangAria')}
              className="h-9 bg-transparent border-0 border-b border-hair rounded-none text-sm text-ink-soft cursor-pointer focus:outline-none focus:border-primary"
            >
              {TRANSLATE_LANGS.map(lang => (
                <option key={lang.value} value={lang.value}>{t(lang.labelKey)}</option>
              ))}
            </select>
          </Row>
          <Row name={t('settings.translate.type')}>
            <select
              value={translateType}
              onChange={e => setTranslateType(e.target.value)}
              aria-label={t('settings.translate.typeAria')}
              className="h-9 bg-transparent border-0 border-b border-hair rounded-none text-sm text-ink-soft cursor-pointer focus:outline-none focus:border-primary"
            >
              {TRANSLATE_TYPES.map(item => (
                <option key={item.value} value={item.value}>{t(item.labelKey)}</option>
              ))}
            </select>
          </Row>
        </Section>

        {/* 歌词外观 */}
        <Section title={t('settings.lyrics')} tag={t('settings.lyrics.tag')}>
          <Row name={t('settings.lyrics.fontSize')} desc={t('settings.lyrics.fontSizeDesc')}>
            <div className="flex items-center gap-3">
              <Slider
                value={[lyricsFontSize]}
                min={14}
                max={36}
                step={1}
                onValueChange={([v]) => setLyricsFontSize(v)}
                aria-label={t('settings.lyrics.fontSizeAria')}
                className="w-28"
              />
              <span className="num text-xs text-ink-soft w-9 text-right">{lyricsFontSize}px</span>
              <div className="flex gap-2 ml-1">
                {[16, 20, 24, 28, 32].map(size => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setLyricsFontSize(size)}
                    className={cn(
                      'num text-[11px] transition-colors duration-200',
                      lyricsFontSize === size
                        ? 'text-primary border-b border-primary'
                        : 'text-ink-faint hover:text-foreground'
                    )}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </Row>
          <Row name={t('settings.lyrics.useRemote')} desc={t('settings.lyrics.useRemoteDesc')}>
            <Toggle label={t('settings.lyrics.useRemote')} checked={lyricsUseRemote} onChange={setLyricsUseRemote} />
          </Row>
          {lyricsUseRemote && (
            <Row name={t('settings.lyrics.preferRemote')} desc={t('settings.lyrics.preferRemoteDesc')}>
              <Toggle label={t('settings.lyrics.preferRemote')} checked={lyricsPreferRemote} onChange={setLyricsPreferRemote} />
            </Row>
          )}
        </Section>

        {/* 跨设备同步（可选自建后端） */}
        <SyncSettings />

        {/* 歌手档案：默认关闭的第三方查询 */}
        <Section title={t('settings.dossier')} tag={t('settings.dossier.tag')}>
          <Row
            name={t('settings.musicBrainz.name')}
            desc={t('settings.musicBrainz.desc')}
          >
            <Toggle
              checked={musicBrainzEnabled}
              onChange={setMusicBrainzEnabled}
              label={t('settings.musicBrainz.toggle')}
            />
          </Row>
          {musicBrainzEnabled && (
            <div className="flex items-center justify-between gap-6 py-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t('settings.musicBrainz.cache')}</p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  {t('settings.musicBrainz.cacheDesc')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  clearProfileCache()
                  toast({ title: t('settings.musicBrainz.cleared') })
                }}
                className="flex-shrink-0 text-sm text-ink-soft transition-colors hover:text-primary"
              >
                {t('settings.musicBrainz.clear')}
              </button>
            </div>
          )}
        </Section>

        {/* 直连打卡 */}
        <ScrobbleSettings />

        {/* 你的数据：想拿走随时能拿走 */}
        <DataExportSection />

        {/* 关于 */}
        <Section title={t('settings.about')} tag={t('settings.about.tag')}>
          <div className="flex items-center justify-between py-4 border-b border-hair-soft">
            <span className="text-sm text-ink-soft">{t('settings.about.version')}</span>
            <span className="num text-sm">v{pkg.version}</span>
          </div>
          <div className="flex items-center justify-between py-4 border-b border-hair-soft">
            <span className="text-sm text-ink-soft">{t('settings.about.license')}</span>
            <span className="text-sm">MIT License</span>
          </div>
          <div className="flex items-center justify-between py-4 border-b border-hair-soft">
            <span className="text-sm text-ink-soft">GitHub</span>
            <a
              href="https://github.com/baogutang/N1KO-MUSIC"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary underline decoration-hair underline-offset-[6px] hover:decoration-primary transition-colors"
            >
              N1KO-MUSIC
            </a>
          </div>
        </Section>

        {/* 危险区 */}
        {activeServer && (
          <Section title={t('settings.danger')} tag={t('settings.danger.tag')}>
            <div className="flex items-center justify-between gap-6 py-5">
              <div>
                <p className="text-sm font-medium">{t('settings.disconnect.name')}</p>
                <p className="text-xs text-ink-faint mt-0.5">{t('settings.disconnect.desc')}</p>
              </div>
              {confirmDisconnect ? (
                <div className="flex items-center gap-4 flex-shrink-0">
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    className="text-sm font-semibold text-destructive underline decoration-1 underline-offset-[6px] decoration-destructive/40 hover:decoration-destructive transition-colors"
                  >
                    {t('settings.disconnect.confirm')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDisconnect(false)}
                    className="text-sm text-ink-faint hover:text-foreground transition-colors"
                  >
                    {t('action.cancel')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDisconnect(true)}
                  className="flex-shrink-0 flex items-center gap-1.5 text-sm font-semibold text-destructive underline decoration-1 underline-offset-[6px] decoration-destructive/40 hover:decoration-destructive transition-colors"
                >
                  <SignOut className="w-4 h-4" />
                  {t('settings.disconnect.action')}
                </button>
              )}
            </div>
          </Section>
        )}
      </div>

      <Dialog open={pendingRemove !== null} onOpenChange={open => { if (!open) setPendingRemove(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('settings.removeDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('settings.removeDialog.before')}
              <span className="font-medium text-foreground">
                {t('settings.removeDialog.name', {
                  name: servers.find(s => s.id === pendingRemove)?.name ?? '',
                })}
              </span>
              {t('settings.removeDialog.after')}
              {pendingRemove === activeServerId && t('settings.removeDialog.activeWarning')}
              <span className="block mt-2 text-ink-faint">
                {t('settings.removeDialog.safe')}
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setPendingRemove(null)}>{t('action.cancel')}</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingRemove) handleRemove(pendingRemove)
                setPendingRemove(null)
              }}
            >
              {t('action.remove')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
