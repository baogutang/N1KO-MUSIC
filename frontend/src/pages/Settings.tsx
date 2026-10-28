/**
 * 设置页（v6 舞台光）
 * iOS「设置」式的分组列表：页面大标题，每组是一块抬起的面板，分组标题在面板上方，
 * 选项行左名称 / 说明、右控件，行间一个设备像素的 hairline。皮肤切换已删除，明暗切换保留。
 * 多色 accent 预设与歌词高亮色选择器已随 v2 契约移除（统一强调色）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Trash, CheckCircle, ArrowsClockwise,
  SignOut, CaretRight, WifiHigh,
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { SourcesSettings } from '@/components/settings/SourcesSettings'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { useServerStore, getServerTypeLabel } from '@/store/serverStore'
import { useThemeStore } from '@/store/themeStore'
import { LOCALES, setLocale, useT } from '@/i18n'
import { usePlayerStore } from '@/store/playerStore'
import {
  useSettingsStore,
  QUALITY_LABEL_KEYS,
  type AudioQuality,
  type CoverShape,
  type CardMode,
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
  Segmented,
  SubHead,
  Toggle,
  fieldInputClass,
  rowClass,
  selectClass,
} from '@/components/settings/primitives'
import { SyncSettings } from '@/components/settings/SyncSettings'
import { ScrobbleSettings } from '@/components/settings/ScrobbleSettings'
import { PlaybackDiagnostics } from '@/components/settings/PlaybackDiagnostics'
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

/** 端点配置行：左标签，右输入框；说明折到下一行 */
function EndpointRow({ label, value, onChange, placeholder, desc }: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  desc?: React.ReactNode
}) {
  return (
    <div className={cn(rowClass, 'flex-wrap gap-y-2')}>
      <p className="w-20 flex-shrink-0 text-[15px] font-medium text-ink">{label}</p>
      <Input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(fieldInputClass, 'min-w-0 flex-1 basis-48')}
      />
      {desc && <p className="basis-full text-[13px] leading-snug text-ink-3 regular:pl-24">{desc}</p>}
    </div>
  )
}

/**
 * 面板里的一组单选：名称与说明在上，选项在下；选中项的圆点是叶绿（暗色下是青柠）。
 * inline 时选项横向排开（选项短、数量少），否则一项一行。
 */
function ChoiceRow<T extends string>({ name, desc, groupLabel, value, onChange, options, inline }: {
  name: string
  desc: string
  groupLabel: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  inline?: boolean
}) {
  return (
    <div className={cn(rowClass, 'flex-col items-stretch gap-x-0')}>
      <p className="text-[15px] font-medium leading-snug text-ink">{name}</p>
      <p className="mt-0.5 max-w-[52ch] text-[13px] leading-snug text-ink-3">{desc}</p>
      <div
        role="radiogroup"
        aria-label={groupLabel}
        className={cn('mt-1', inline && 'flex flex-wrap gap-x-7')}
      >
        {options.map(opt => {
          const on = value === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(opt.value)}
              className={cn(
                'group flex min-h-[44px] items-center gap-3 text-left',
                !inline && 'w-full'
              )}
            >
              <span
                className={cn(
                  'grid h-5 w-5 flex-shrink-0 place-items-center rounded-full border-2 transition-colors duration-2 motion-reduce:transition-none',
                  on ? 'border-leaf' : 'border-edge group-hover:border-ink-3'
                )}
              >
                {on && <span className="h-2.5 w-2.5 rounded-full bg-leaf" />}
              </span>
              <span
                className={cn(
                  'text-[15px] transition-colors duration-2 motion-reduce:transition-none',
                  on ? 'font-medium text-ink' : 'text-ink-2 group-hover:text-ink'
                )}
              >
                {opt.label}
              </span>
            </button>
          )
        })}
      </div>
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
      ].filter(Boolean).join(t('common.listSeparator'))
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
    <Section title={t('section.yourData')}>
      <Row
        name={t('settings.export.name')}
        desc={
          count == null
            ? t('settings.export.counting')
            : t('settings.export.desc', { count })
        }
      >
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => handleExport('json')} className="h-11 [@media(hover:hover)]:h-9">
            JSON
          </Button>
          <Button variant="secondary" size="sm" onClick={() => handleExport('csv')} className="h-11 [@media(hover:hover)]:h-9">
            CSV
          </Button>
        </div>
      </Row>

      <Row name={t('settings.import.name')} desc={t('settings.import.desc')}>
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
        <Button
          variant="secondary"
          size="sm"
          disabled={importing || !serverId}
          onClick={() => importInputRef.current?.click()}
          className="h-11 [@media(hover:hover)]:h-9"
        >
          {importing ? t('settings.import.busy') : t('action.chooseFile')}
        </Button>
      </Row>
    </Section>
  )
}

export default function Settings() {
  const navigate = useNavigate()
  const { servers, activeServerId, activateServer, removeServer, disconnect } = useServerStore()
  const { theme, setTheme } = useThemeStore()
  const { t, locale } = useT()
  const volume    = usePlayerStore(s => s.volume)
  const setVolume = usePlayerStore(s => s.setVolume)
  const {
    apiPreferServer, apiAuthToken,
    coverRemoteTemplate, coverLoadAlbum, coverLoadArtist, coverShape, playerCardMode,
    lyricsRemoteTemplate, lyricsConfirmTemplate, lyricsUseRemote, lyricsPreferRemote, lyricsFontSize,
    songDetailTemplate, songDetailPathReplace,
    translateTargetLang, translateType,
    audioQuality, cellularAudioQuality, adaptiveQuality,
    replayGainMode, replayGainPreamp,
    playbackRate, smoothTransitions, preloadNext, autoContinueQueue,
    notificationActions, seekStepSeconds, resumeAfterInterruption, musicBrainzEnabled,
    setApiPreferServer, setApiAuthToken,
    setCoverRemoteTemplate, setCoverLoadAlbum, setCoverLoadArtist, setCoverShape, setPlayerCardMode,
    setLyricsRemoteTemplate, setLyricsConfirmTemplate, setLyricsUseRemote, setLyricsPreferRemote, setLyricsFontSize,
    setSongDetailTemplate, setSongDetailPathReplace,
    setTranslateTargetLang, setTranslateType,
    setAudioQuality, setCellularAudioQuality, setAdaptiveQuality,
    setReplayGainMode, setReplayGainPreamp,
    setPlaybackRate, setSmoothTransitions, setPreloadNext, setAutoContinueQueue,
    setNotificationActions, setSeekStepSeconds, setResumeAfterInterruption, setMusicBrainzEnabled,
  } = useSettingsStore()
  const connectedServerIds = useServerStore(s => s.connectedServerIds)
  const [pinging, setPinging] = useState<string | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  // 删除服务器会连同 URL、用户名与令牌一起永久抹掉且无法撤销，必须二次确认
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
  // 换主库会清空播放队列并清缓存——同样是不可撤销的代价，先说清楚
  const [pendingPrimary, setPendingPrimary] = useState<string | null>(null)
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
        title: t('sources.relogin'),
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
    <div className="min-h-full pb-8 pt-3">
      <div className="max-w-[720px]">
        <h1 className="font-display text-[34px] font-bold leading-[1.05] tracking-[-0.03em] text-ink regular:text-[44px]">
          {t('nav.settings')}
        </h1>

        <div className="mt-8 flex flex-col gap-8">
        {/*
          音源 —— NAS 类服务器与插件音源同列。
          在这个 App 里它们是同一种东西：一个能出曲子的来源。此前分成
          「服务器管理」和「音源」两节，网易云既被当成服务器列在上面，
          又在下面被管一遍，用户得自己拼出「这两处说的是同一个东西」。

          词汇约定（全站）：界面上「服务器」只用于 NAS 类，「音源」用于插件，
          「主库」指当前决定浏览页与默认适配器的那一个。
        */}
        <Section title={t('settings.sources')}>
          {servers.map(server => {
            const isPlugin = server.type === 'plugin'
            const isPrimary = server.id === activeServerId
            const connected = connectedServerIds.includes(server.id)
            return (
              <div key={server.id} className={cn(rowClass, 'justify-between gap-4')}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <SourceBadge serverId={server.id} />
                    <p className="min-w-0 truncate text-[15px] font-medium text-ink">{server.name}</p>
                    {/* 类型徽标：一眼分清这一行是 NAS 服务器还是插件音源。
                        文案是要翻译、要读懂的，不是装饰性的拉丁小标签 */}
                    <span className="flex-shrink-0 rounded-pill bg-fill px-2 py-0.5 text-[11px] font-semibold text-ink-2">
                      {isPlugin ? t('sources.typeLabel') : t('sources.typeLabelNas')}
                    </span>
                    {isPrimary && (
                      <span className="flex flex-shrink-0 items-center gap-1 text-[12px] font-semibold text-leaf">
                        <CheckCircle weight="fill" className="h-3.5 w-3.5" />
                        {t('sources.settings.primary')}
                      </span>
                    )}
                  </div>
                  {/* 地址只有 NAS 有意义：插件的服务端是它自己写死的，用户既填不了也改不了 */}
                  {!isPlugin && <p className="num mt-0.5 truncate text-[13px] text-ink-3">{server.url}</p>}
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-ink-3">
                    <span>{isPlugin ? (server.pluginId ?? t('sources.typeLabel')) : getServerTypeLabel(server.type)}</span>
                    {/* 早先的插件行在盘上存的账号名是字面量 'anonymous'：按有无凭据翻成人话 */}
                    {server.username && (
                      <span>
                        {server.username === 'anonymous'
                          ? (server.credentials ? t('sources.signedIn') : t('sources.notSignedIn'))
                          : server.username}
                      </span>
                    )}
                    <span className={connected ? 'text-ink-2' : undefined}>
                      {connected ? t('settings.source.connected') : t('settings.server.notConnected')}
                    </span>
                  </div>
                </div>
                <div className="-mr-2 flex flex-shrink-0 items-center">
                  {/* 测试连接只对 NAS 成立：它按 ServerConfig 造一个适配器去 ping，
                      插件音源根本没有可 ping 的地址，这个按钮此前点了必然报错 */}
                  {!isPlugin && (
                    <Button
                      type="button"
                      variant="icon"
                      size="icon"
                      onClick={() => handlePing(server.id)}
                      disabled={pinging === server.id}
                      className="h-11 w-11"
                      title={t('settings.server.ping')}
                      aria-label={t('settings.server.pingAria', { name: server.name })}
                    >
                      {pinging === server.id
                        ? <ArrowsClockwise className="h-[18px] w-[18px] animate-spin motion-reduce:animate-none" />
                        : <WifiHigh className="h-[18px] w-[18px]" />
                      }
                    </Button>
                  )}
                  {!isPrimary && (
                    <Button
                      type="button"
                      variant="icon"
                      size="icon"
                      /* 换主库会清空播放队列并清缓存（serverStore.setPrimaryServer），
                         这是个有代价的动作，先说清楚再问 */
                      onClick={() => setPendingPrimary(server.id)}
                      className="h-11 w-11 hover:text-leaf"
                      title={t('settings.source.setPrimary')}
                      aria-label={t('settings.source.setPrimaryAria', { name: server.name })}
                    >
                      <CaretRight className="h-[18px] w-[18px]" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="icon"
                    size="icon"
                    onClick={() => setPendingRemove(server.id)}
                    className="h-11 w-11 hover:text-danger"
                    title={t('settings.source.remove')}
                    aria-label={t('settings.server.removeAria', { name: server.name })}
                  >
                    <Trash className="h-[18px] w-[18px]" />
                  </Button>
                </div>
              </div>
            )
          })}

          {supportsScan && (
            <Row
              name={t('settings.scan.name')}
              desc={t('settings.scan.desc')}
            >
              <Button
                variant="secondary"
                size="sm"
                onClick={() => scan.mutate()}
                disabled={scan.isPending}
                className="h-11 [@media(hover:hover)]:h-9"
              >
                <ArrowsClockwise
                  size={14}
                  className={scan.isPending ? 'animate-spin motion-reduce:animate-none' : undefined}
                />
                {scan.isPending ? t('settings.scan.busy') : t('settings.scan.start')}
              </Button>
            </Row>
          )}

          <div className={rowClass}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate('/login')}
              className="gap-1.5 h-11 [@media(hover:hover)]:h-9"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('settings.source.add')}
            </Button>
          </div>
        </Section>

        {/* 插件：安装 / 更新 / 卸载 / 请求日志 / 目录地址 / 播放优先序。
            这一节管的是插件**代码**和播放顺序；音源本身（含设主库）在上面那一节。
            设主库只剩上面那一个按钮——它会先说清「队列会清空」再问；
            这里原来还有一个无声生效的「主库」下拉，同一个动作两种后果 */}
        <SourcesSettings />

        {/* 界面语言 */}
        <Section title={t('settings.language')}>
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

        {/* 外观：皮肤已收敛为一套，只剩明暗 */}
        <Section title={t('settings.appearance')}>
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
          <Row name={t('settings.cardMode.name')} desc={t('settings.cardMode.desc')}>
            <Segmented
              label={t('settings.cardMode.name')}
              value={playerCardMode}
              onChange={(v) => setPlayerCardMode(v as CardMode)}
              options={[
                { value: 'auto', label: t('settings.cardMode.auto') },
                { value: 'always', label: t('settings.cardMode.always') },
                { value: 'off', label: t('settings.cardMode.off') },
              ]}
            />
          </Row>
        </Section>

        {/* 音频 */}
        <Section title={t('settings.audio')}>
          <Row name={t('settings.volume.name')}>
            <div className="flex w-60 items-center gap-3">
              <Slider
                value={[volume]}
                min={0}
                max={1}
                step={0.01}
                onValueChange={([v]) => setVolume(v)}
                aria-label={t('settings.volume.name')}
                className="flex-1"
              />
              <span className="num w-9 text-right text-[13px] text-ink-2">
                {Math.round(volume * 100)}%
              </span>
            </div>
          </Row>

          <ChoiceRow
            name={t('settings.quality.wifi')}
            desc={t('settings.quality.desc')}
            groupLabel={t('settings.quality.wifiAria')}
            value={audioQuality}
            onChange={setAudioQuality}
            options={(Object.keys(QUALITY_LABEL_KEYS) as AudioQuality[]).map(q => ({
              value: q,
              label: t(QUALITY_LABEL_KEYS[q]),
            }))}
          />

          <Row
            name={t('settings.adaptiveQuality.name')}
            desc={t('settings.adaptiveQuality.desc')}
          >
            <Toggle checked={adaptiveQuality} onChange={setAdaptiveQuality} label={t('settings.adaptiveQuality.name')} />
          </Row>

          {adaptiveQuality && (
            <ChoiceRow
              name={t('settings.quality.cellular')}
              desc={t('settings.quality.cellularDesc')}
              groupLabel={t('settings.quality.cellularAria')}
              value={cellularAudioQuality}
              onChange={setCellularAudioQuality}
              options={(Object.keys(QUALITY_LABEL_KEYS) as AudioQuality[]).map(q => ({
                value: q,
                label: t(QUALITY_LABEL_KEYS[q]),
              }))}
            />
          )}

          <ChoiceRow
            inline
            name={t('settings.replayGain.name')}
            desc={t('settings.replayGain.desc')}
            groupLabel={t('settings.replayGain.label')}
            value={replayGainMode}
            onChange={setReplayGainMode}
            options={REPLAY_GAIN_OPTIONS.map(opt => ({ value: opt.value, label: t(opt.labelKey) }))}
          />

          {replayGainMode !== 'off' && (
            <Row name={t('settings.preamp.name')} desc={t('settings.preamp.desc')}>
              <div className="flex w-60 items-center gap-3">
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
                <span className="num w-14 text-right text-[13px] text-ink-2">
                  {replayGainPreamp > 0 ? '+' : ''}{replayGainPreamp} dB
                </span>
              </div>
            </Row>
          )}

          <Row name={t('settings.playbackRate.name')} desc={t('settings.playbackRate.desc')}>
            <div className="flex w-60 items-center gap-3">
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
              <span className="num w-12 text-right text-[13px] text-ink-2">
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
                <span className="num w-10 text-right text-[13px] text-ink-2">{seekStepSeconds}s</span>
              </div>
            </Row>
          )}
          <Row
            name={t('player.carMode')}
            desc={t('settings.carMode.desc')}
          >
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => usePlayerStore.getState().setCarMode(true)}
              className="h-11 [@media(hover:hover)]:h-9"
            >
              {t('settings.carMode.enter')}
            </Button>
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
        <Section title={t('settings.customApi')}>
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
                <code className="num mx-1 rounded-sm bg-fill px-1.5 py-0.5 text-ink-2">Authorization</code>
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
              className={selectClass}
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
              className={selectClass}
            >
              {TRANSLATE_TYPES.map(item => (
                <option key={item.value} value={item.value}>{t(item.labelKey)}</option>
              ))}
            </select>
          </Row>
        </Section>

        {/* 歌词外观 */}
        <Section title={t('settings.lyrics')}>
          <Row name={t('settings.lyrics.fontSize')} desc={t('settings.lyrics.fontSizeDesc')}>
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
              <Slider
                value={[lyricsFontSize]}
                min={14}
                max={36}
                step={1}
                onValueChange={([v]) => setLyricsFontSize(v)}
                aria-label={t('settings.lyrics.fontSizeAria')}
                className="w-28"
              />
              <span className="num w-10 text-right text-[13px] text-ink-2">{lyricsFontSize}px</span>
              <Segmented
                label={t('settings.lyrics.fontSize')}
                value={String(lyricsFontSize)}
                onChange={v => setLyricsFontSize(Number(v))}
                options={[16, 20, 24, 28, 32].map(size => ({ value: String(size), label: String(size) }))}
              />
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
        <Section title={t('settings.dossier')}>
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
            <Row
              name={t('settings.musicBrainz.cache')}
              desc={t('settings.musicBrainz.cacheDesc')}
            >
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  clearProfileCache()
                  toast({ title: t('settings.musicBrainz.cleared') })
                }}
                className="h-11 [@media(hover:hover)]:h-9"
              >
                {t('settings.musicBrainz.clear')}
              </Button>
            </Row>
          )}
        </Section>

        {/* 直连打卡 */}
        <ScrobbleSettings />

        {/* 你的数据：想拿走随时能拿走 */}
        <DataExportSection />

        {/* 关于：版本号是页面上唯一保留的版本信息 */}
        <Section title={t('settings.about')}>
          <Row name={t('settings.about.version')}>
            <span className="num text-[15px] text-ink-2">v{pkg.version}</span>
          </Row>
          <PlaybackDiagnostics />
          <Row name={t('settings.about.license')}>
            <span className="text-[15px] text-ink-2">MIT License</span>
          </Row>
          <Row name="GitHub">
            <a
              href="https://github.com/baogutang/N1KO-MUSIC"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-sm text-[15px] text-leaf underline-offset-4 hover:underline"
            >
              N1KO-MUSIC
            </a>
          </Row>
        </Section>

        {/* 危险区 */}
        {activeServer && (
          <Section title={t('settings.danger')}>
            <Row name={t('settings.disconnect.name')} desc={t('settings.disconnect.desc')}>
              {confirmDisconnect ? (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={handleDisconnect}
                    className="h-11 [@media(hover:hover)]:h-9"
                  >
                    {t('settings.disconnect.confirm')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDisconnect(false)}
                    className="h-11 [@media(hover:hover)]:h-9"
                  >
                    {t('action.cancel')}
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setConfirmDisconnect(true)}
                  className="gap-1.5 text-danger h-11 [@media(hover:hover)]:h-9"
                >
                  <SignOut className="h-4 w-4" />
                  {t('settings.disconnect.action')}
                </Button>
              )}
            </Row>
          </Section>
        )}
        </div>
      </div>

      {/* 换主库的后果先说清楚：队列会被清空、正在放的那一首会停。
          此前这个按钮点下去就直接换了，音乐当场没了也没人解释一句 */}
      <Dialog open={pendingPrimary !== null} onOpenChange={open => { if (!open) setPendingPrimary(null) }}>
        <DialogContent className="regular:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('settings.primaryDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('settings.primaryDialog.desc', {
                name: servers.find(s => s.id === pendingPrimary)?.name ?? '',
              })}
              <span className="mt-2 block text-ink-3">{t('settings.primaryDialog.safe')}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setPendingPrimary(null)}>{t('action.cancel')}</Button>
            <Button
              onClick={() => {
                const id = pendingPrimary
                setPendingPrimary(null)
                if (id) void handleSwitch(id)
              }}
            >
              {t('settings.primaryDialog.confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingRemove !== null} onOpenChange={open => { if (!open) setPendingRemove(null) }}>
        <DialogContent className="regular:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('settings.removeDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('settings.removeDialog.before')}
              <span className="font-semibold text-ink">
                {t('settings.removeDialog.name', {
                  name: servers.find(s => s.id === pendingRemove)?.name ?? '',
                })}
              </span>
              {t('settings.removeDialog.after')}
              {pendingRemove === activeServerId && t('settings.removeDialog.activeWarning')}
              <span className="mt-2 block text-ink-3">
                {t('settings.removeDialog.safe')}
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setPendingRemove(null)}>{t('action.cancel')}</Button>
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
