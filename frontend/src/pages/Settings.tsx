/**
 * 设置页
 * 杂志编辑风（DESIGN v2 §4.4）：衬线分区标题 + 发丝线，选项行式排布
 * （左名称/说明，右控件），开关为细线滑块，输入框为发丝线下缘。
 * 多色 accent 预设与歌词高亮色选择器已随 v2 契约移除（统一朱红 accent）。
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Trash, CheckCircle, ArrowsClockwise,
  SignOut, CaretRight, WifiHigh,
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useServerStore, getServerTypeLabel } from '@/store/serverStore'
import { useThemeStore } from '@/store/themeStore'
import { usePlayerStore } from '@/store/playerStore'
import {
  useSettingsStore,
  QUALITY_LABELS,
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
import { readListeningEvents } from '@/services/listeningHistory'
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
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-sm border border-hair overflow-hidden divide-x divide-hair-soft">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => onChange(opt.value)}
          style={value === opt.value ? { boxShadow: 'inset 0 -2px 0 0 rgb(var(--accent))' } : undefined}
          className={cn(
            'px-3.5 h-8 text-[13px] transition-colors duration-200',
            value === opt.value ? 'text-primary font-medium' : 'text-ink-soft hover:text-foreground'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

/** 端点配置行：左标签，右发丝线输入框 */
const REPLAY_GAIN_OPTIONS: Array<{ value: ReplayGainMode; label: string }> = [
  { value: 'off', label: '关闭' },
  { value: 'auto', label: '自动' },
  { value: 'track', label: '按单曲' },
  { value: 'album', label: '按专辑' },
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
  const serverId = useServerStore(s => s.activeServerId)
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    setCount(serverId ? readListeningEvents(serverId).length : 0)
  }, [serverId])

  const handleExport = (format: 'json' | 'csv') => {
    if (!serverId) return
    const events = readListeningEvents(serverId)
    if (!events.length) {
      toast({ title: '还没有可导出的收听记录' })
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
    toast({ title: `已导出 ${events.length} 条收听记录` })
  }

  return (
    <Section title="你的数据" tag="YOUR DATA">
      <div className="flex items-center justify-between gap-6 py-5">
        <div className="min-w-0">
          <p className="text-sm font-medium">导出收听历史</p>
          <p className="mt-0.5 text-xs text-ink-faint">
            {count == null
              ? '正在统计…'
              : `本机共 ${count} 条记录，在浏览器里直接生成，不经过任何服务器`}
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
    </Section>
  )
}

export default function Settings() {
  const navigate = useNavigate()
  const { servers, activeServerId, activateServer, removeServer, disconnect } = useServerStore()
  const { theme, setTheme } = useThemeStore()
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
    setApiPreferServer, setApiAuthToken,
    setCoverRemoteTemplate, setCoverLoadAlbum, setCoverLoadArtist, setCoverShape,
    setLyricsRemoteTemplate, setLyricsConfirmTemplate, setLyricsUseRemote, setLyricsPreferRemote, setLyricsFontSize,
    setSongDetailTemplate, setSongDetailPathReplace,
    setTranslateTargetLang, setTranslateType,
    setAudioQuality, setCellularAudioQuality, setAdaptiveQuality,
    setReplayGainMode, setReplayGainPreamp,
    setPlaybackRate, setSmoothTransitions, setPreloadNext, setAutoContinueQueue,
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
        title: ok ? '连接正常' : '连接失败',
        variant: ok ? 'default' : 'destructive',
      })
    } catch {
      toast({ title: '无法连接到服务器', variant: 'destructive' })
    } finally {
      setPinging(null)
    }
  }

  function handleSwitch(id: string) {
    if (!activateServer(id)) {
      toast({
        title: '该服务器需要重新登录',
        description: '登录凭据已升级，请在登录页重新连接',
        variant: 'destructive',
      })
      return
    }
    toast({ title: '已切换服务器' })
  }

  function handleRemove(id: string) {
    if (id === activeServerId) {
      disconnect()
      navigate('/login')
    }
    removeServer(id)
    toast({ title: '已移除服务器' })
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
          <p className="text-[11px] tracking-[0.3em] text-ink-faint mb-2">PREFERENCES</p>
          <h1 className="font-serif text-4xl font-bold tracking-tight">设置</h1>
        </header>

        {/* 服务器管理 */}
        <Section title="服务器管理" tag="SERVERS">
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
                          当前
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
                    title="测试连接"
                    aria-label={`测试 ${server.name} 连接`}
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
                      title="切换到此服务器"
                      aria-label={`切换到 ${server.name}`}
                    >
                      <CaretRight className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPendingRemove(server.id)}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-ink-faint hover:text-destructive transition-colors duration-200 active:scale-95"
                    title="移除服务器"
                    aria-label={`移除 ${server.name}`}
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}

            {supportsScan && (
              <Row
                name="重新扫描音乐库"
                desc="往 NAS 里放了新专辑之后，不必再打开服务器后台"
              >
                <button
                  onClick={() => scan.mutate()}
                  disabled={scan.isPending}
                  className="inline-flex items-center gap-2 rounded border border-hair px-3.5 py-1.5 text-[13px] text-ink-soft transition-colors duration-200 hover:border-ink hover:text-ink disabled:opacity-50"
                >
                  <ArrowsClockwise size={13} className={scan.isPending ? 'animate-spin' : undefined} />
                  {scan.isPending ? '扫描中' : '开始扫描'}
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
              添加新服务器
            </Button>
          </div>
        </Section>

        {/* 外观 */}
        <Section title="外观" tag="APPEARANCE">
          <Row name="主题模式" desc="深色、浅色或跟随系统">
            <Segmented
              label="主题模式"
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'dark', label: '深色' },
                { value: 'light', label: '浅色' },
                { value: 'system', label: '跟随系统' },
              ]}
            />
          </Row>
          <Row name="播放详情页封面样式" desc="方形静止或黑胶旋转（唱片效果）">
            <Segmented
              label="封面样式"
              value={coverShape}
              onChange={(v) => setCoverShape(v as CoverShape)}
              options={[
                { value: 'square', label: '方形' },
                { value: 'circle', label: '黑胶' },
              ]}
            />
          </Row>
        </Section>

        {/* 音频 */}
        <Section title="音频" tag="AUDIO">
          <Row name="默认音量">
            <div className="flex items-center gap-3 w-60">
              <Slider
                value={[volume]}
                min={0}
                max={1}
                step={0.01}
                onValueChange={([v]) => setVolume(v)}
                aria-label="默认音量"
                className="flex-1"
              />
              <span className="num text-xs text-ink-soft w-9 text-right">
                {Math.round(volume * 100)}%
              </span>
            </div>
          </Row>
          <div className="py-4 border-b border-hair-soft">
            <p className="text-sm font-medium">流媒体音质 · Wi-Fi / 局域网</p>
            <p className="text-xs text-ink-faint mt-0.5">
              无损将请求服务器原始歌曲格式；其他选项将要求服务器转码为指定码率
            </p>
            <div role="radiogroup" aria-label="Wi-Fi 流媒体音质" className="mt-2">
              {(Object.keys(QUALITY_LABELS) as AudioQuality[]).map(q => (
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
                    {QUALITY_LABELS[q]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <Row
            name="按网络类型自动切换音质"
            desc="在蜂窝网络下改用下方的移动网络档位，避免从家里的上行拉原始文件"
          >
            <Toggle checked={adaptiveQuality} onChange={setAdaptiveQuality} label="按网络类型自动切换音质" />
          </Row>

          {adaptiveQuality && (
            <div className="py-4 border-b border-hair-soft">
              <p className="text-sm font-medium">流媒体音质 · 移动网络</p>
              <p className="text-xs text-ink-faint mt-0.5">
                检测到蜂窝网络或系统省流量模式时使用
              </p>
              <div role="radiogroup" aria-label="移动网络流媒体音质" className="mt-2">
                {(Object.keys(QUALITY_LABELS) as AudioQuality[]).map(q => (
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
                      {QUALITY_LABELS[q]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="py-4 border-b border-hair-soft">
            <p className="text-sm font-medium">音量归一化 · ReplayGain</p>
            <p className="text-xs text-ink-faint mt-0.5 max-w-[52ch]">
              读取服务器已算好的增益，让不同年代的母带响度一致。
              「自动」在顺序播放整张专辑时保留专辑内部动态，随机播放时逐曲归一。
            </p>
            <div role="radiogroup" aria-label="音量归一化" className="mt-2 flex flex-wrap gap-x-7 gap-y-1">
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
                    {opt.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {replayGainMode !== 'off' && (
            <Row name="前置增益" desc="归一化之后再整体加减，单位分贝">
              <div className="flex items-center gap-3 w-60">
                <Slider
                  value={[replayGainPreamp]}
                  min={-15}
                  max={15}
                  step={0.5}
                  onValueChange={([v]) => setReplayGainPreamp(v)}
                  aria-label="前置增益"
                  aria-valuetext={`${replayGainPreamp > 0 ? '+' : ''}${replayGainPreamp} 分贝`}
                  className="flex-1"
                />
                <span className="num text-xs text-ink-soft w-12 text-right">
                  {replayGainPreamp > 0 ? '+' : ''}{replayGainPreamp} dB
                </span>
              </div>
            </Row>
          )}

          <Row name="播放速度" desc="有声书、讲座与广播剧适用，已开启变调补偿">
            <div className="flex items-center gap-3 w-60">
              <Slider
                value={[playbackRate]}
                min={0.5}
                max={3}
                step={0.05}
                onValueChange={([v]) => setPlaybackRate(v)}
                aria-label="播放速度"
                aria-valuetext={`${playbackRate.toFixed(2)} 倍速`}
                className="flex-1"
              />
              <span className="num text-xs text-ink-soft w-12 text-right">
                {playbackRate.toFixed(2)}×
              </span>
            </div>
          </Row>

          <Row name="预加载下一首" desc="提前把下一首拉进缓存，切歌几乎没有空档（移动网络下不启用）">
            <Toggle checked={preloadNext} onChange={setPreloadNext} label="预加载下一首" />
          </Row>

          <Row name="队列播完自动续接" desc="按当前曲目继续找相似曲目接上，而不是直接停下">
            <Toggle checked={autoContinueQueue} onChange={setAutoContinueQueue} label="队列播完自动续接" />
          </Row>

          <Row name="平滑过渡" desc="暂停与切歌时做短暂渐弱，而不是硬切">
            <Toggle checked={smoothTransitions} onChange={setSmoothTransitions} label="平滑过渡" />
          </Row>
        </Section>

        {/* 自定义 API */}
        <Section title="自定义 API" tag="CUSTOM API">
          <Row name="优先使用音乐服务接口" desc="只有音乐服务接口无数据时才会从自定义 API 获取数据">
            <Toggle label="优先使用音乐服务接口" checked={apiPreferServer} onChange={setApiPreferServer} />
          </Row>

          <EndpointRow
            label="验证信息"
            value={apiAuthToken}
            onChange={setApiAuthToken}
            placeholder="Authorization Token"
            desc={(
              <>
                验证信息将作为请求头的
                <code className="num text-ink-soft border border-hair-soft rounded-sm px-1 mx-1">Authorization</code>
                字段进行传输
              </>
            )}
          />

          <SubHead title="歌词接口" />
          <EndpointRow
            label="地址"
            value={lyricsRemoteTemplate}
            onChange={setLyricsRemoteTemplate}
            placeholder="https://lrcapi.example.com/api?title={title}&artist={artist}"
          />

          <SubHead title="歌词确认接口" />
          <EndpointRow
            label="地址"
            value={lyricsConfirmTemplate}
            onChange={setLyricsConfirmTemplate}
            placeholder="https://lrcapi.example.com/confirm"
          />

          <SubHead title="封面接口" />
          <EndpointRow
            label="地址"
            value={coverRemoteTemplate}
            onChange={setCoverRemoteTemplate}
            placeholder="https://api.example.com/cover?artist={artist}&album={album}"
          />
          <Row name="加载专辑封面">
            <Toggle label="加载专辑封面" checked={coverLoadAlbum} onChange={setCoverLoadAlbum} />
          </Row>
          <Row name="加载歌手图片">
            <Toggle label="加载歌手图片" checked={coverLoadArtist} onChange={setCoverLoadArtist} />
          </Row>

          <SubHead title="歌曲详情接口" />
          <EndpointRow
            label="地址"
            value={songDetailTemplate}
            onChange={setSongDetailTemplate}
            placeholder="https://example.com/songs"
          />
          <EndpointRow
            label="路径替换"
            value={songDetailPathReplace}
            onChange={setSongDetailPathReplace}
            placeholder="pattern,replacement"
            desc="配置后可在歌曲详情页跳转至对应网页"
          />

          <SubHead title="翻译接口" />
          <Row name="目标语言">
            <select
              value={translateTargetLang}
              onChange={e => setTranslateTargetLang(e.target.value)}
              aria-label="翻译目标语言"
              className="h-9 bg-transparent border-0 border-b border-hair rounded-none text-sm text-ink-soft cursor-pointer focus:outline-none focus:border-primary"
            >
              {['英文', '中文', '日文', '韩文', '法文', '德文'].map(lang => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </Row>
          <Row name="类型">
            <select
              value={translateType}
              onChange={e => setTranslateType(e.target.value)}
              aria-label="翻译类型"
              className="h-9 bg-transparent border-0 border-b border-hair rounded-none text-sm text-ink-soft cursor-pointer focus:outline-none focus:border-primary"
            >
              {['无', '没有内置翻译', '不内置'].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Row>
        </Section>

        {/* 歌词外观 */}
        <Section title="歌词外观" tag="LYRICS">
          <Row name="字号大小" desc="全屏播放器中歌词的字体大小（14–36px）">
            <div className="flex items-center gap-3">
              <Slider
                value={[lyricsFontSize]}
                min={14}
                max={36}
                step={1}
                onValueChange={([v]) => setLyricsFontSize(v)}
                aria-label="歌词字号"
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
          <Row name="启用远程歌词源" desc="通过上方自定义 API 获取 LRC 歌词，第一条显示设置">
            <Toggle label="启用远程歌词源" checked={lyricsUseRemote} onChange={setLyricsUseRemote} />
          </Row>
          {lyricsUseRemote && (
            <Row name="远程歌词优先" desc="开启时远程优先，关闭时服务器优先">
              <Toggle label="远程歌词优先" checked={lyricsPreferRemote} onChange={setLyricsPreferRemote} />
            </Row>
          )}
        </Section>

        {/* 跨设备同步（可选自建后端） */}
        <SyncSettings />

        {/* 直连打卡 */}
        <ScrobbleSettings />

        {/* 你的数据：想拿走随时能拿走 */}
        <DataExportSection />

        {/* 关于 */}
        <Section title="关于" tag="ABOUT">
          <div className="flex items-center justify-between py-4 border-b border-hair-soft">
            <span className="text-sm text-ink-soft">版本</span>
            <span className="num text-sm">v{pkg.version}</span>
          </div>
          <div className="flex items-center justify-between py-4 border-b border-hair-soft">
            <span className="text-sm text-ink-soft">开源协议</span>
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
          <Section title="危险区" tag="DANGER">
            <div className="flex items-center justify-between gap-6 py-5">
              <div>
                <p className="text-sm font-medium">断开当前服务器连接</p>
                <p className="text-xs text-ink-faint mt-0.5">将退出登录并返回服务器选择页</p>
              </div>
              {confirmDisconnect ? (
                <div className="flex items-center gap-4 flex-shrink-0">
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    className="text-sm font-semibold text-destructive underline decoration-1 underline-offset-[6px] decoration-destructive/40 hover:decoration-destructive transition-colors"
                  >
                    确认断开
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDisconnect(false)}
                    className="text-sm text-ink-faint hover:text-foreground transition-colors"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDisconnect(true)}
                  className="flex-shrink-0 flex items-center gap-1.5 text-sm font-semibold text-destructive underline decoration-1 underline-offset-[6px] decoration-destructive/40 hover:decoration-destructive transition-colors"
                >
                  <SignOut className="w-4 h-4" />
                  断开连接
                </button>
              )}
            </div>
          </Section>
        )}
      </div>

      <Dialog open={pendingRemove !== null} onOpenChange={open => { if (!open) setPendingRemove(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>移除这个服务器？</DialogTitle>
            <DialogDescription>
              将永久删除
              <span className="font-medium text-foreground">
                「{servers.find(s => s.id === pendingRemove)?.name ?? ''}」
              </span>
              的地址、用户名与登录凭据，无法撤销。
              {pendingRemove === activeServerId && '这是当前连接的服务器，移除后会退出到服务器选择页。'}
              <span className="block mt-2 text-ink-faint">
                服务器上的音乐不会受到任何影响。
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setPendingRemove(null)}>取消</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingRemove) handleRemove(pendingRemove)
                setPendingRemove(null)
              }}
            >
              移除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
