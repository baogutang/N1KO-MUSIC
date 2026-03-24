import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Server, Plus, Trash2, CheckCircle2, RefreshCw,
  Sun, Moon, Volume2, Palette, Info, LogOut, ChevronRight, Wifi,
  Music2, Radio, Link, KeyRound, Image as ImageIcon,
  FileText, ArrowLeftRight, Globe, Languages, Disc3,
  Crown, Lock,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useServerStore, getServerTypeLabel } from '@/store/serverStore'
import { useThemeStore, type AccentColor } from '@/store/themeStore'
import { usePlayerStore } from '@/store/playerStore'
import { useMemberStore } from '@/store/memberStore'
import {
  useSettingsStore,
  QUALITY_LABELS,
  type AudioQuality,
  type CoverShape,
} from '@/store/settingsStore'
import { getAdapter } from '@/api'
import { toast } from '@/components/ui/use-toast'
import { MemberUpgradeDialog } from '@/components/member/MemberUpgradeDialog'

const VERSION = '1.1.0'

export default function Settings() {
  const navigate = useNavigate()
  const isPremium = useMemberStore(s => s.isPremium)
  const [memberUpgradeOpen, setMemberUpgradeOpen] = useState(false)
  const { servers, activeServerId, activateServer, removeServer, disconnect } = useServerStore()
  const { resolvedTheme, toggleTheme, accentColor, setAccentColor } = useThemeStore()
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
  const [pinging, setPinging] = useState<string | null>(null)

  const activeServer = servers.find(s => s.id === activeServerId)

  async function handlePing(serverId: string) {
    setPinging(serverId)
    try {
      const adapter = getAdapter()
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
    { label: 'Spotify 绿', value: 'green', className: 'bg-[#1DB954]' },
    { label: 'Apple 红', value: 'red', className: 'bg-[#FA233B]' },
    { label: '天空蓝', value: 'blue', className: 'bg-[#0EA5E9]' },
    { label: '紫罗兰', value: 'purple', className: 'bg-[#8B5CF6]' },
    { label: '橙色', value: 'orange', className: 'bg-[#F97316]' },
  ]

  return (
    <div className="min-h-full pb-8">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-3xl font-bold mb-8">设置</h1>

        {/* Server management */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Server className="w-5 h-5 text-primary" />
            服务器管理
          </h2>

          <div className="space-y-3">
            {servers.map(server => (
              <div
                key={server.id}
                className={cn(
                  'bg-card rounded-xl p-4 border transition-colors',
                  server.id === activeServerId
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-border hover:border-border/80'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={cn(
                      'w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0',
                      server.id === activeServerId
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                    )}>
                      {getServerTypeLabel(server.type).charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">{server.name}</p>
                        {server.id === activeServerId && (
                          <span className="text-xs text-primary font-medium flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            当前
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{server.url}</p>
                      <p className="text-xs text-muted-foreground">{getServerTypeLabel(server.type)} · {server.username}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                    <button
                      onClick={() => handlePing(server.id)}
                      disabled={pinging === server.id}
                      className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                      title="测试连接"
                    >
                      {pinging === server.id
                        ? <RefreshCw className="w-4 h-4 animate-spin" />
                        : <Wifi className="w-4 h-4" />
                      }
                    </button>
                    {server.id !== activeServerId && (
                      <button
                        onClick={() => handleSwitch(server.id)}
                        className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                        title="切换到此服务器"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => handleRemove(server.id)}
                      className="p-2 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                      title="移除服务器"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}

            <button
              onClick={() => navigate('/login')}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-primary/5 transition-colors text-muted-foreground hover:text-foreground"
            >
              <Plus className="w-4 h-4" />
              添加新服务器
            </button>
          </div>
        </section>

        {/* Appearance */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Palette className="w-5 h-5 text-primary" />
            外观
          </h2>

          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {/* Theme mode */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <p className="font-medium">主题模式</p>
                <p className="text-sm text-muted-foreground">深色或浅色</p>
              </div>
              <button
                onClick={toggleTheme}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
              >
                {resolvedTheme === 'dark' ? (
                  <><Moon className="w-4 h-4" /><span className="text-sm">深色</span></>
                ) : (
                  <><Sun className="w-4 h-4" /><span className="text-sm">浅色</span></>
                )}
              </button>
            </div>

            {/* Accent color */}
            <div className="p-4 border-b border-border">
              <p className="font-medium mb-1">强调色</p>
              <p className="text-sm text-muted-foreground mb-3">界面主题颜色</p>
              <div className="flex gap-2 flex-wrap">
                {accentOptions.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setAccentColor(opt.value)}
                    title={opt.label}
                    className={cn(
                      'w-8 h-8 rounded-full transition-transform hover:scale-110',
                      opt.className,
                      accentColor === opt.value && 'ring-2 ring-offset-2 ring-offset-card ring-white scale-110'
                    )}
                  />
                ))}
              </div>
            </div>

            {/* 播放详情页封面样式 */}
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-purple-500/15 flex items-center justify-center flex-shrink-0">
                  <Disc3 className="w-4 h-4 text-purple-400" />
                </div>
                <div>
                  <p className="font-medium text-sm">播放详情页封面样式</p>
                  <p className="text-xs text-muted-foreground">方形静止或圆形旋转（黑胶唱片效果）</p>
                </div>
              </div>
              <div className="flex gap-1.5">
                {(['square', 'circle'] as CoverShape[]).map(shape => (
                  <button
                    key={shape}
                    onClick={() => setCoverShape(shape)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-sm transition-colors',
                      coverShape === shape
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-accent'
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
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Volume2 className="w-5 h-5 text-primary" />
            音频
          </h2>

          <div className="bg-card rounded-xl border border-border p-4 space-y-5">
            {/* 默认音量 */}
            <div className="flex items-center gap-4">
              <Volume2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium mb-1">默认音量</p>
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
              <span className="text-sm text-muted-foreground w-10 text-right">
                {Math.round(volume * 100)}%
              </span>
            </div>

            {/* 音质选择 */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Radio className="w-4 h-4 text-muted-foreground" />
                <p className="font-medium">流媒体音质</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(QUALITY_LABELS) as AudioQuality[]).map(q => (
                  <button
                    key={q}
                    onClick={() => setAudioQuality(q)}
                    className={cn(
                      'relative px-3 py-2.5 rounded-lg border text-sm text-left transition-colors',
                      audioQuality === q
                        ? 'border-primary bg-primary/10 text-primary font-medium'
                        : 'border-border hover:border-primary/40 hover:bg-muted text-muted-foreground'
                    )}
                  >
                    {QUALITY_LABELS[q]}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                无损将请求服务器原始歌曲格式；其他选项将要求服务器转码为指定码率
              </p>
            </div>
          </div>
        </section>

        {/* 自定义 API（仅会员） */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Globe className="w-5 h-5 text-primary" />
            自定义 API
            {!isPremium && (
              <span className="ml-auto flex items-center gap-1 text-[11px] text-amber-500/80">
                <Crown className="w-3 h-3" />
                会员专属
              </span>
            )}
          </h2>

          {isPremium ? (
          <div className="bg-card rounded-xl border border-border overflow-hidden space-y-px">

            {/* 优先使用音乐服务接口 */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center flex-shrink-0">
                  <Globe className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <p className="font-medium text-sm">优先使用音乐服务接口</p>
                  <p className="text-xs text-muted-foreground">只有音乐服务接口无数据时才会从自定义 API 获取数据</p>
                </div>
              </div>
              <button
                onClick={() => setApiPreferServer(!apiPreferServer)}
                className={cn(
                  'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
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
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-green-500/15 flex items-center justify-center flex-shrink-0">
                  <KeyRound className="w-4 h-4 text-green-400" />
                </div>
                <p className="font-medium text-sm flex-shrink-0">验证信息</p>
              </div>
              <input
                type="text"
                value={apiAuthToken}
                onChange={e => setApiAuthToken(e.target.value)}
                placeholder="Authorization Token"
                className="text-sm text-right bg-transparent border-none outline-none text-muted-foreground placeholder:text-muted-foreground/40 min-w-0 w-48"
              />
            </div>
            <p className="px-4 py-2 text-xs text-muted-foreground border-b border-border">
              验证信息将作为请求头的 <code className="bg-muted px-1 rounded">Authorization</code> 字段进行传输
            </p>

            {/* 歌词接口 标题 */}
            <div className="px-4 pt-4 pb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">歌词接口</p>
            </div>

            {/* 歌词接口 - 地址 */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="w-8 h-8 rounded-lg bg-purple-500/15 flex items-center justify-center flex-shrink-0">
                  <Link className="w-4 h-4 text-purple-400" />
                </div>
                <p className="font-medium text-sm">地址</p>
              </div>
              <input
                type="text"
                value={lyricsRemoteTemplate}
                onChange={e => setLyricsRemoteTemplate(e.target.value)}
                placeholder="https://lrcapi.example.com/api?title={title}&artist={artist}"
                className="text-sm text-right bg-transparent border-none outline-none text-muted-foreground placeholder:text-muted-foreground/40 min-w-0 flex-1 ml-4"
              />
            </div>

            {/* 歌词确认接口 标题 */}
            <div className="px-4 pt-4 pb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">歌词确认接口</p>
            </div>

            {/* 歌词确认接口 - 地址 */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="w-8 h-8 rounded-lg bg-purple-500/15 flex items-center justify-center flex-shrink-0">
                  <Link className="w-4 h-4 text-purple-400" />
                </div>
                <p className="font-medium text-sm">地址</p>
              </div>
              <input
                type="text"
                value={lyricsConfirmTemplate}
                onChange={e => setLyricsConfirmTemplate(e.target.value)}
                placeholder="https://lrcapi.example.com/confirm"
                className="text-sm text-right bg-transparent border-none outline-none text-muted-foreground placeholder:text-muted-foreground/40 min-w-0 flex-1 ml-4"
              />
            </div>

            {/* 封面接口 标题 */}
            <div className="px-4 pt-4 pb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">封面接口</p>
            </div>

            {/* 封面接口 - 地址 */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="w-8 h-8 rounded-lg bg-purple-500/15 flex items-center justify-center flex-shrink-0">
                  <Link className="w-4 h-4 text-purple-400" />
                </div>
                <p className="font-medium text-sm">地址</p>
              </div>
              <input
                type="text"
                value={coverRemoteTemplate}
                onChange={e => setCoverRemoteTemplate(e.target.value)}
                placeholder="https://api.example.com/cover?artist={artist}&album={album}"
                className="text-sm text-right bg-transparent border-none outline-none text-muted-foreground placeholder:text-muted-foreground/40 min-w-0 flex-1 ml-4"
              />
            </div>

            {/* 加载专辑封面 */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-orange-500/15 flex items-center justify-center flex-shrink-0">
                  <ImageIcon className="w-4 h-4 text-orange-400" />
                </div>
                <p className="font-medium text-sm">加载专辑封面</p>
              </div>
              <button
                onClick={() => setCoverLoadAlbum(!coverLoadAlbum)}
                className={cn(
                  'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
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
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-pink-500/15 flex items-center justify-center flex-shrink-0">
                  <ImageIcon className="w-4 h-4 text-pink-400" />
                </div>
                <p className="font-medium text-sm">加载歌手图片</p>
              </div>
              <button
                onClick={() => setCoverLoadArtist(!coverLoadArtist)}
                className={cn(
                  'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
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
            <div className="px-4 pt-4 pb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">歌曲详情接口</p>
            </div>

            {/* 歌曲详情 - 地址 */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="w-8 h-8 rounded-lg bg-purple-500/15 flex items-center justify-center flex-shrink-0">
                  <Link className="w-4 h-4 text-purple-400" />
                </div>
                <p className="font-medium text-sm">地址</p>
              </div>
              <input
                type="text"
                value={songDetailTemplate}
                onChange={e => setSongDetailTemplate(e.target.value)}
                placeholder="https://example.com/songs"
                className="text-sm text-right bg-transparent border-none outline-none text-muted-foreground placeholder:text-muted-foreground/40 min-w-0 flex-1 ml-4"
              />
            </div>

            {/* 歌曲详情 - 路径替换 */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/15 flex items-center justify-center flex-shrink-0">
                  <ArrowLeftRight className="w-4 h-4 text-cyan-400" />
                </div>
                <p className="font-medium text-sm">路径替换</p>
              </div>
              <input
                type="text"
                value={songDetailPathReplace}
                onChange={e => setSongDetailPathReplace(e.target.value)}
                placeholder="pattern,replacement"
                className="text-sm text-right bg-transparent border-none outline-none text-muted-foreground placeholder:text-muted-foreground/40 min-w-0 w-48"
              />
            </div>
            <p className="px-4 py-2 text-xs text-muted-foreground border-b border-border">配置后可在歌曲详情页跳转至对应网页</p>

            {/* 翻译接口 标题 */}
            <div className="px-4 pt-4 pb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">翻译接口</p>
            </div>

            {/* 翻译 - 目标语言 */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center flex-shrink-0">
                  <Globe className="w-4 h-4 text-blue-400" />
                </div>
                <p className="font-medium text-sm">目标语言</p>
              </div>
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
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/15 flex items-center justify-center flex-shrink-0">
                  <Languages className="w-4 h-4 text-indigo-400" />
                </div>
                <p className="font-medium text-sm">类型</p>
              </div>
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
          ) : (
            <div className="bg-card rounded-xl border border-border p-8 text-center">
              <Lock className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground mb-1">自定义 API 仅对会员开放</p>
              <p className="text-xs text-muted-foreground/60 mb-4">升级会员后解锁封面搜索、歌词搜索、歌曲详情等高级配置</p>
              <button
                onClick={() => setMemberUpgradeOpen(true)}
                className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
              >
                <Crown className="w-4 h-4 inline mr-1.5" />升级会员
              </button>
            </div>
          )}
        </section>

        {/* 歌词外观设置 */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Music2 className="w-5 h-5 text-primary" />
            歌词外观
          </h2>

          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {/* 歌词高亮颜色 */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <p className="font-medium">高亮颜色</p>
                <p className="text-xs text-muted-foreground">当前播放歌词行的高亮颜色</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex gap-1.5">
                  {[
                    { color: '#22c55e', label: '绿色' },
                    { color: '#ffffff', label: '白色' },
                    { color: '#f59e0b', label: '黄色' },
                    { color: '#60a5fa', label: '蓝色' },
                    { color: '#f472b6', label: '粉色' },
                    { color: '#a78bfa', label: '紫色' },
                  ].map(({ color, label }) => (
                    <button
                      key={color}
                      title={label}
                      onClick={() => setLyricsHighlightColor(color)}
                      className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 flex-shrink-0"
                      style={{
                        backgroundColor: color,
                        borderColor: lyricsHighlightColor === color ? 'white' : 'transparent',
                        boxShadow: lyricsHighlightColor === color ? `0 0 0 1px ${color}` : 'none',
                      }}
                    />
                  ))}
                </div>
                <input
                  type="color"
                  value={lyricsHighlightColor}
                  onChange={e => setLyricsHighlightColor(e.target.value)}
                  className="w-8 h-8 rounded-lg cursor-pointer border border-border bg-transparent overflow-hidden"
                  title="自定义颜色"
                />
              </div>
            </div>

            {/* 歌词字号 */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <p className="font-medium">字号大小</p>
                <p className="text-xs text-muted-foreground">全屏播放器中歌词的字体大小（14–36px）</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-8 text-right tabular-nums">{lyricsFontSize}px</span>
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
                        'text-xs px-2 py-0.5 rounded transition-colors',
                        lyricsFontSize === size
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-accent'
                      )}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 启用远程歌词 */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <p className="font-medium">启用远程歌词源</p>
                <p className="text-xs text-muted-foreground">通过上方自定义 API 获取 LRC 歌词，第一条显示设置</p>
              </div>
              <button
                onClick={() => setLyricsUseRemote(!lyricsUseRemote)}
                className={cn(
                  'relative w-11 h-6 rounded-full transition-colors',
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
              <div className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">远程歌词优先</p>
                  <p className="text-xs text-muted-foreground">开启时远程优先，关闭时服务器优先</p>
                </div>
                <button
                  onClick={() => setLyricsPreferRemote(!lyricsPreferRemote)}
                  className={cn(
                    'relative w-11 h-6 rounded-full transition-colors',
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
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Info className="w-5 h-5 text-primary" />
            关于
          </h2>

          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <span className="text-muted-foreground">版本</span>
              <span className="font-mono text-sm">v{VERSION}</span>
            </div>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <span className="text-muted-foreground">开源协议</span>
              <span className="text-sm">MIT License</span>
            </div>
            <div className="flex items-center justify-between p-4">
              <span className="text-muted-foreground">GitHub</span>
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
          <section>
            <button
              onClick={() => {
                disconnect()
                navigate('/login')
              }}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-destructive/30 hover:bg-destructive/10 transition-colors text-destructive"
            >
              <LogOut className="w-4 h-4" />
              断开当前服务器连接
            </button>
          </section>
        )}
      </div>

      <MemberUpgradeDialog
        open={memberUpgradeOpen}
        onOpenChange={setMemberUpgradeOpen}
      />
    </div>
  )
}
