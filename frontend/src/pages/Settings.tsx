import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Trash, CheckCircle, ArrowsClockwise,
  Sun, Moon, Monitor, SpeakerHigh, SignOut, CaretRight, WifiHigh,
  CrownSimple, Lock,
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useServerStore, getServerTypeLabel } from '@/store/serverStore'
import { useThemeStore, type AccentColor } from '@/store/themeStore'
import { usePlayerStore } from '@/store/playerStore'
import {
  useSettingsStore,
  QUALITY_LABELS,
  type AudioQuality,
  type CoverShape,
} from '@/store/settingsStore'
import { createAdapter } from '@/api'
import { toast } from '@/components/ui/use-toast'
import { useMemberStore } from '@/store/memberStore'

const VERSION = '1.2.5'

export default function Settings() {
  const navigate = useNavigate()
  const { servers, activeServerId, activateServer, removeServer, disconnect } = useServerStore()
  const { theme, setTheme, accentColor, setAccentColor } = useThemeStore()
  const volume    = usePlayerStore(s => s.volume)
  const setVolume = usePlayerStore(s => s.setVolume)
  const {
    apiPreferServer, apiAuthToken,
    coverRemoteTemplate, coverLoadAlbum, coverLoadArtist, coverShape,
    lyricsRemoteTemplate, lyricsConfirmTemplate, lyricsUseRemote, lyricsPreferRemote, lyricsHighlightColor, lyricsFontSize,
    songDetailTemplate, songDetailPathReplace,
    translateTargetLang, translateType,
    audioQuality,
    setApiPreferServer, setApiAuthToken,
    setCoverRemoteTemplate, setCoverLoadAlbum, setCoverLoadArtist, setCoverShape,
    setLyricsRemoteTemplate, setLyricsConfirmTemplate, setLyricsUseRemote, setLyricsPreferRemote, setLyricsHighlightColor, setLyricsFontSize,
    setSongDetailTemplate, setSongDetailPathReplace,
    setTranslateTargetLang, setTranslateType,
    setAudioQuality,
  } = useSettingsStore()
  const isPremium = useMemberStore(s => s.isPremium)
  const [pinging, setPinging] = useState<string | null>(null)

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
    activateServer(id)
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

  const accentOptions: { label: string; value: AccentColor; className: string }[] = [
    { label: 'Spotify 绿', value: 'green', className: 'bg-[#2ec27e]' },
    { label: 'Apple 红', value: 'red', className: 'bg-[#e0525b]' },
    { label: '天空蓝', value: 'blue', className: 'bg-[#4e94ed]' },
    { label: '紫罗兰', value: 'purple', className: 'bg-[#9f78e3]' },
    { label: '橙色', value: 'orange', className: 'bg-[#ee8e3a]' },
  ]

  return (
    <div className="min-h-full pb-8 animate-fade-in">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-3xl font-bold tracking-tight mb-10">设置</h1>

        {/* Server management */}
        <section className="pb-10">
          <h2 className="text-lg font-bold mb-5">服务器管理</h2>

          <div className="space-y-1">
            {servers.map(server => (
              <div
                key={server.id}
                className={cn(
                  'flex items-center justify-between gap-2 px-3 py-3 rounded-lg transition-colors duration-150',
                  server.id === activeServerId
                    ? 'bg-primary/10'
                    : 'hover:bg-surface'
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={cn(
                    'w-10 h-10 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0',
                    server.id === activeServerId
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-accent text-muted-foreground'
                  )}>
                    {getServerTypeLabel(server.type).charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{server.name}</p>
                      {server.id === activeServerId && (
                        <span className="text-xs text-primary font-medium flex items-center gap-1 flex-shrink-0">
                          <CheckCircle weight="fill" className="w-3.5 h-3.5" />
                          当前
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{server.url}</p>
                    <p className="text-xs text-muted-foreground">{getServerTypeLabel(server.type)} · {server.username}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                  <button
                    onClick={() => handlePing(server.id)}
                    disabled={pinging === server.id}
                    className="p-2 rounded-md hover:bg-accent transition-colors duration-150 text-muted-foreground hover:text-foreground active:scale-[0.94]"
                    title="测试连接"
                  >
                    {pinging === server.id
                      ? <ArrowsClockwise className="w-4 h-4 animate-spin" />
                      : <WifiHigh className="w-4 h-4" />
                    }
                  </button>
                  {server.id !== activeServerId && (
                    <button
                      onClick={() => handleSwitch(server.id)}
                      className="p-2 rounded-md hover:bg-accent transition-colors duration-150 text-muted-foreground hover:text-foreground active:scale-[0.94]"
                      title="切换到此服务器"
                    >
                      <CaretRight className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleRemove(server.id)}
                    className="p-2 rounded-md hover:bg-destructive/10 transition-colors duration-150 text-muted-foreground hover:text-destructive active:scale-[0.94]"
                    title="移除服务器"
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}

            <button
              onClick={() => navigate('/login')}
              className="w-full flex items-center justify-center gap-2 h-10 !mt-3 rounded-full border border-border text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors duration-150 active:scale-[0.97]"
            >
              <Plus className="w-4 h-4" />
              添加新服务器
            </button>
          </div>
        </section>

        {/* Appearance */}
        <section className="border-t border-border pt-8 pb-10">
          <h2 className="text-lg font-bold mb-2">外观</h2>

          <div className="divide-y divide-border">
            {/* Theme mode */}
            <div className="py-5 space-y-3">
              <div>
                <p className="font-medium text-sm">主题模式</p>
                <p className="text-xs text-muted-foreground mt-0.5">深色、浅色或跟随系统</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                {([
                  { value: 'dark' as const, label: '深色', icon: Moon },
                  { value: 'light' as const, label: '浅色', icon: Sun },
                  { value: 'system' as const, label: '跟随系统', icon: Monitor },
                ]).map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => setTheme(value)}
                    className={cn(
                      'flex items-center gap-2 px-4 h-9 rounded-full text-sm transition-colors duration-150 border active:scale-[0.97]',
                      theme === value
                        ? 'border-primary bg-primary/10 text-primary font-medium'
                        : 'border-border text-muted-foreground hover:text-foreground hover:bg-surface'
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Accent color */}
            <div className="py-5">
              <p className="font-medium text-sm">强调色</p>
              <p className="text-xs text-muted-foreground mt-0.5 mb-4">界面主题颜色</p>
              <div className="flex gap-4 flex-wrap">
                {accentOptions.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setAccentColor(opt.value)}
                    title={opt.label}
                    className={cn(
                      'w-7 h-7 rounded-full transition-transform duration-150 hover:scale-110 active:scale-95',
                      opt.className,
                      accentColor === opt.value && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                    )}
                  />
                ))}
              </div>
            </div>

            {/* 播放详情页封面样式 */}
            <div className="flex items-center justify-between gap-4 py-5">
              <div>
                <p className="font-medium text-sm">播放详情页封面样式</p>
                <p className="text-xs text-muted-foreground mt-0.5">方形静止或圆形旋转（黑胶唱片效果）</p>
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                {(['square', 'circle'] as CoverShape[]).map(shape => (
                  <button
                    key={shape}
                    onClick={() => setCoverShape(shape)}
                    className={cn(
                      'px-3.5 h-8 rounded-full text-sm transition-colors duration-150 border active:scale-[0.97]',
                      coverShape === shape
                        ? 'border-primary bg-primary/10 text-primary font-medium'
                        : 'border-border text-muted-foreground hover:text-foreground hover:bg-surface'
                    )}
                  >
                    {shape === 'square' ? '方形' : '圆形旋转'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Audio */}
        <section className="border-t border-border pt-8 pb-10">
          <h2 className="text-lg font-bold mb-2">音频</h2>

          <div className="divide-y divide-border">
            {/* 默认音量 */}
            <div className="flex items-center gap-4 py-5">
              <SpeakerHigh className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-sm mb-1.5">默认音量</p>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={e => setVolume(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>
              <span className="font-num text-sm text-muted-foreground w-10 text-right">
                {Math.round(volume * 100)}%
              </span>
            </div>

            {/* 音质选择 */}
            <div className="py-5">
              <div className="flex items-center gap-2 mb-3">
                <p className="font-medium text-sm">流媒体音质</p>
                {!isPremium && (
                  <span className="ml-auto flex items-center gap-1 text-[11px] text-amber-500/80">
                    <CrownSimple weight="fill" className="w-3 h-3" />
                    会员解锁高音质
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(QUALITY_LABELS) as AudioQuality[]).map(q => {
                  // 非会员只允许省流（low），其余选项锁定
                  const locked = !isPremium && q !== 'low'
                  return (
                    <button
                      key={q}
                      disabled={locked}
                      onClick={() => !locked && setAudioQuality(q)}
                      title={locked ? '升级会员后可使用此音质' : undefined}
                      className={cn(
                        'relative px-4 h-9 rounded-full border text-sm transition-colors duration-150',
                        locked
                          ? 'border-border/40 text-muted-foreground/40 cursor-not-allowed select-none'
                          : audioQuality === q
                            ? 'border-primary bg-primary/10 text-primary font-medium active:scale-[0.97]'
                            : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground active:scale-[0.97]'
                      )}
                    >
                      <span className="flex items-center justify-center gap-1.5">
                        {QUALITY_LABELS[q]}
                        {locked && <Lock className="w-3 h-3 text-amber-500/50 flex-shrink-0" />}
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                {isPremium
                  ? '无损将请求服务器原始歌曲格式；其他选项将要求服务器转码为指定码率'
                  : '当前为省流模式（128kbps）；升级会员后可解锁无损、高质量等更多音质选项'}
              </p>
            </div>
          </div>
        </section>

        {/* 自定义 API */}
        <section className="border-t border-border pt-8 pb-10">
          <h2 className="text-lg font-bold mb-2">自定义 API</h2>

          <div>
            {/* 优先使用音乐服务接口 */}
            <div className="flex items-center justify-between gap-4 py-4 border-b border-border">
              <div>
                <p className="font-medium text-sm">优先使用音乐服务接口</p>
                <p className="text-xs text-muted-foreground mt-0.5">只有音乐服务接口无数据时才会从自定义 API 获取数据</p>
              </div>
              <button
                onClick={() => setApiPreferServer(!apiPreferServer)}
                className={cn(
                  'relative w-11 h-6 rounded-full transition-colors duration-150 flex-shrink-0',
                  apiPreferServer ? 'bg-primary' : 'bg-muted-foreground/30'
                )}
              >
                <span className={cn(
                  'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                  apiPreferServer && 'translate-x-5'
                )} />
              </button>
            </div>

            {/* 验证信息 */}
            <div className="flex items-center justify-between gap-4 py-4">
              <p className="font-medium text-sm flex-shrink-0">验证信息</p>
              <input
                type="text"
                value={apiAuthToken}
                onChange={e => setApiAuthToken(e.target.value)}
                placeholder="Authorization Token"
                className="text-sm text-right bg-transparent border-none outline-none text-muted-foreground placeholder:text-muted-foreground/40 min-w-0 w-48"
              />
            </div>
            <p className="pb-4 text-xs text-muted-foreground border-b border-border">
              验证信息将作为请求头的 <code className="bg-accent px-1 rounded-md">Authorization</code> 字段进行传输
            </p>

            {/* 歌词接口 标题 */}
            <p className="pt-5 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">歌词接口</p>

            {/* 歌词接口 - 地址 */}
            <div className="flex items-center justify-between py-4 border-b border-border">
              <p className="font-medium text-sm flex-shrink-0">地址</p>
              <input
                type="text"
                value={lyricsRemoteTemplate}
                onChange={e => setLyricsRemoteTemplate(e.target.value)}
                placeholder="https://lrcapi.example.com/api?title={title}&artist={artist}"
                className="text-sm text-right bg-transparent border-none outline-none text-muted-foreground placeholder:text-muted-foreground/40 min-w-0 flex-1 ml-4"
              />
            </div>

            {/* 歌词确认接口 标题 */}
            <p className="pt-5 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">歌词确认接口</p>

            {/* 歌词确认接口 - 地址 */}
            <div className="flex items-center justify-between py-4 border-b border-border">
              <p className="font-medium text-sm flex-shrink-0">地址</p>
              <input
                type="text"
                value={lyricsConfirmTemplate}
                onChange={e => setLyricsConfirmTemplate(e.target.value)}
                placeholder="https://lrcapi.example.com/confirm"
                className="text-sm text-right bg-transparent border-none outline-none text-muted-foreground placeholder:text-muted-foreground/40 min-w-0 flex-1 ml-4"
              />
            </div>

            {/* 封面接口 标题 */}
            <p className="pt-5 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">封面接口</p>

            {/* 封面接口 - 地址 */}
            <div className="flex items-center justify-between py-4 border-b border-border">
              <p className="font-medium text-sm flex-shrink-0">地址</p>
              <input
                type="text"
                value={coverRemoteTemplate}
                onChange={e => setCoverRemoteTemplate(e.target.value)}
                placeholder="https://api.example.com/cover?artist={artist}&album={album}"
                className="text-sm text-right bg-transparent border-none outline-none text-muted-foreground placeholder:text-muted-foreground/40 min-w-0 flex-1 ml-4"
              />
            </div>

            {/* 加载专辑封面 */}
            <div className="flex items-center justify-between gap-4 py-4 border-b border-border">
              <p className="font-medium text-sm">加载专辑封面</p>
              <button
                onClick={() => setCoverLoadAlbum(!coverLoadAlbum)}
                className={cn(
                  'relative w-11 h-6 rounded-full transition-colors duration-150 flex-shrink-0',
                  coverLoadAlbum ? 'bg-primary' : 'bg-muted-foreground/30'
                )}
              >
                <span className={cn(
                  'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                  coverLoadAlbum && 'translate-x-5'
                )} />
              </button>
            </div>

            {/* 加载歌手图片 */}
            <div className="flex items-center justify-between gap-4 py-4 border-b border-border">
              <p className="font-medium text-sm">加载歌手图片</p>
              <button
                onClick={() => setCoverLoadArtist(!coverLoadArtist)}
                className={cn(
                  'relative w-11 h-6 rounded-full transition-colors duration-150 flex-shrink-0',
                  coverLoadArtist ? 'bg-primary' : 'bg-muted-foreground/30'
                )}
              >
                <span className={cn(
                  'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                  coverLoadArtist && 'translate-x-5'
                )} />
              </button>
            </div>

            {/* 歌曲详情接口 标题 */}
            <p className="pt-5 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">歌曲详情接口</p>

            {/* 歌曲详情 - 地址 */}
            <div className="flex items-center justify-between py-4 border-b border-border">
              <p className="font-medium text-sm flex-shrink-0">地址</p>
              <input
                type="text"
                value={songDetailTemplate}
                onChange={e => setSongDetailTemplate(e.target.value)}
                placeholder="https://example.com/songs"
                className="text-sm text-right bg-transparent border-none outline-none text-muted-foreground placeholder:text-muted-foreground/40 min-w-0 flex-1 ml-4"
              />
            </div>

            {/* 歌曲详情 - 路径替换 */}
            <div className="flex items-center justify-between py-4">
              <p className="font-medium text-sm flex-shrink-0">路径替换</p>
              <input
                type="text"
                value={songDetailPathReplace}
                onChange={e => setSongDetailPathReplace(e.target.value)}
                placeholder="pattern,replacement"
                className="text-sm text-right bg-transparent border-none outline-none text-muted-foreground placeholder:text-muted-foreground/40 min-w-0 w-48"
              />
            </div>
            <p className="pb-4 text-xs text-muted-foreground border-b border-border">配置后可在歌曲详情页跳转至对应网页</p>

            {/* 翻译接口 标题 */}
            <p className="pt-5 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">翻译接口</p>

            {/* 翻译 - 目标语言 */}
            <div className="flex items-center justify-between py-4 border-b border-border">
              <p className="font-medium text-sm flex-shrink-0">目标语言</p>
              <select
                value={translateTargetLang}
                onChange={e => setTranslateTargetLang(e.target.value)}
                className="text-sm bg-transparent border-none outline-none text-muted-foreground cursor-pointer"
              >
                {['英文', '中文', '日文', '韩文', '法文', '德文'].map(lang => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
              </select>
            </div>

            {/* 翻译 - 类型 */}
            <div className="flex items-center justify-between py-4">
              <p className="font-medium text-sm flex-shrink-0">类型</p>
              <select
                value={translateType}
                onChange={e => setTranslateType(e.target.value)}
                className="text-sm bg-transparent border-none outline-none text-muted-foreground cursor-pointer"
              >
                {['无', '没有内置山误', '不内置'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* 歌词外观设置 */}
        <section className="border-t border-border pt-8 pb-10">
          <h2 className="text-lg font-bold mb-2">歌词外观</h2>

          <div className="divide-y divide-border">
            {/* 歌词高亮颜色 */}
            <div className="flex items-center justify-between gap-4 py-5">
              <div>
                <p className="font-medium text-sm">高亮颜色</p>
                <p className="text-xs text-muted-foreground mt-0.5">当前播放歌词行的高亮颜色</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="flex gap-1.5">
                  {[
                    { color: '#2ec27e', label: '绿色' },
                    { color: '#14b8a6', label: '青色' },
                    { color: '#f59e0b', label: '黄色' },
                    { color: '#60a5fa', label: '蓝色' },
                    { color: '#f472b6', label: '粉色' },
                    { color: '#a78bfa', label: '紫色' },
                  ].map(({ color, label }) => (
                    <button
                      key={color}
                      title={label}
                      onClick={() => setLyricsHighlightColor(color)}
                      className="w-6 h-6 rounded-full border-2 transition-transform duration-150 hover:scale-110 active:scale-95 flex-shrink-0"
                      style={{
                        backgroundColor: color,
                        borderColor: lyricsHighlightColor === color ? 'hsl(var(--foreground))' : 'transparent',
                        boxShadow: lyricsHighlightColor === color ? `0 0 0 1px ${color}` : 'none',
                      }}
                    />
                  ))}
                </div>
                <input
                  type="color"
                  value={lyricsHighlightColor}
                  onChange={e => setLyricsHighlightColor(e.target.value)}
                  className="w-8 h-8 rounded-md cursor-pointer border border-border bg-transparent overflow-hidden"
                  title="自定义颜色"
                />
              </div>
            </div>

            {/* 歌词字号 */}
            <div className="flex items-center justify-between gap-4 py-5">
              <div>
                <p className="font-medium text-sm">字号大小</p>
                <p className="text-xs text-muted-foreground mt-0.5">全屏播放器中歌词的字体大小（14–36px）</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="font-num text-xs text-muted-foreground w-9 text-right">{lyricsFontSize}px</span>
                <input
                  type="range"
                  min={14}
                  max={36}
                  step={1}
                  value={lyricsFontSize}
                  onChange={e => setLyricsFontSize(Number(e.target.value))}
                  className="w-28 accent-primary cursor-pointer"
                />
                <div className="flex gap-1">
                  {[16, 20, 24, 28, 32].map(size => (
                    <button
                      key={size}
                      onClick={() => setLyricsFontSize(size)}
                      className={cn(
                        'font-num text-xs px-2 py-1 rounded-md transition-colors duration-150 active:scale-[0.94]',
                        lyricsFontSize === size
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-accent text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 启用远程歌词 */}
            <div className="flex items-center justify-between gap-4 py-5">
              <div>
                <p className="font-medium text-sm">启用远程歌词源</p>
                <p className="text-xs text-muted-foreground mt-0.5">通过上方自定义 API 获取 LRC 歌词，第一条显示设置</p>
              </div>
              <button
                onClick={() => setLyricsUseRemote(!lyricsUseRemote)}
                className={cn(
                  'relative w-11 h-6 rounded-full transition-colors duration-150 flex-shrink-0',
                  lyricsUseRemote ? 'bg-primary' : 'bg-muted-foreground/30'
                )}
              >
                <span className={cn(
                  'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                  lyricsUseRemote && 'translate-x-5'
                )} />
              </button>
            </div>

            {lyricsUseRemote && (
              <div className="flex items-center justify-between gap-4 py-5">
                <div>
                  <p className="font-medium text-sm">远程歌词优先</p>
                  <p className="text-xs text-muted-foreground mt-0.5">开启时远程优先，关闭时服务器优先</p>
                </div>
                <button
                  onClick={() => setLyricsPreferRemote(!lyricsPreferRemote)}
                  className={cn(
                    'relative w-11 h-6 rounded-full transition-colors duration-150 flex-shrink-0',
                    lyricsPreferRemote ? 'bg-primary' : 'bg-muted-foreground/30'
                  )}
                >
                  <span className={cn(
                    'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                    lyricsPreferRemote && 'translate-x-5'
                  )} />
                </button>
              </div>
            )}
          </div>
        </section>

        {/* About */}
        <section className="border-t border-border pt-8 pb-10">
          <h2 className="text-lg font-bold mb-2">关于</h2>

          <div className="divide-y divide-border">
            <div className="flex items-center justify-between py-4">
              <span className="text-sm text-muted-foreground">版本</span>
              <span className="font-num text-sm">v{VERSION}</span>
            </div>
            <div className="flex items-center justify-between py-4">
              <span className="text-sm text-muted-foreground">开源协议</span>
              <span className="text-sm">MIT License</span>
            </div>
            <div className="flex items-center justify-between py-4">
              <span className="text-sm text-muted-foreground">GitHub</span>
              <a
                href="https://github.com/baogutang/N1KO-MUSIC"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline"
              >
                N1KO-MUSIC
              </a>
            </div>
          </div>
        </section>

        {/* Danger zone */}
        {activeServer && (
          <section className="border-t border-border pt-8">
            <button
              onClick={() => {
                disconnect()
                navigate('/login')
              }}
              className="w-full flex items-center justify-center gap-2 h-10 rounded-full border border-destructive/30 hover:bg-destructive/10 transition-colors duration-150 text-sm text-destructive active:scale-[0.97]"
            >
              <SignOut className="w-4 h-4" />
              断开当前服务器连接
            </button>
          </section>
        )}
      </div>
    </div>
  )
}
