/**
 * 服务器登录页 —— 纸面杂志化（DESIGN v2 §4.4/§4.5）
 * 居中窄栏：品牌报头 + 衬线大标题；服务器类型为发丝线行式单选，
 * 已存服务器为编号行式快速连接；错误直接陈述
 * NAS：Subsonic/Navidrome/Jellyfin/Emby；流媒体音源：已安装插件（PLAN 1.6）——
 * 后者只在有出网通道的壳里给入口，正式版的纯浏览器换成一句说明加下载链接
 * （见 lib/platform 的 pluginSourcesSupported）
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CaretRight, CircleNotch, Eye, EyeSlash, Plus, X } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useServerStore, getServerTypeLabel } from '@/store/serverStore'
import { pluginSourcesSupported } from '@/lib/platform'
import { createAdapter } from '@/api'
import type { ServerType } from '@/api/types'
import { useT } from '@/i18n'
import { usePluginStore, type InstalledPluginSummary } from '@/plugins/host/pluginStore'
import { pluginLogoSrc, SourceLogo } from '@/components/sources/SourceBadge'
import { closeAuthHost, getPluginHost, openAuthHost } from '@/plugins/host/pluginRuntime'
import type { PluginHost } from '@/plugins/host/PluginHost'
import type { PluginManifest, PluginUser } from '@/plugins/types'
import { PluginDisclaimer } from '@/components/sources/PluginDisclaimer'
import { QrLogin } from '@/components/sources/QrLogin'
import { CookieLogin } from '@/components/sources/CookieLogin'
import { AddPluginDialog } from '@/components/sources/AddPluginDialog'

// 说明句只存 key：这张表在模块加载时就建好了，直接存译文会把语言钉死在首次加载那一刻
const SERVER_TYPES: Array<{ type: ServerType; label: string; descKey: string }> = [
  { type: 'navidrome', label: 'Navidrome', descKey: 'login.type.navidrome' },
  { type: 'subsonic', label: 'Subsonic', descKey: 'login.type.subsonic' },
  { type: 'jellyfin', label: 'Jellyfin', descKey: 'login.type.jellyfin' },
  { type: 'emby', label: 'Emby', descKey: 'login.type.emby' },
]

/** 发行页：浏览器版里唯一有意义的下一步就是去拿一个带出网通道的壳。
 *  音源设置里有同一份文案，但那边不共用常量——登录页的首屏包没有理由
 *  为了一个字符串把插件宿主、目录、请求日志那一整块拖进来。 */
const RELEASES_URL = 'https://github.com/baogutang/N1KO-MUSIC/releases/latest'

/** 已确认过声明的插件（卸载或换设备后要重新确认） */
const DISCLAIMER_KEY = 'n1ko-plugin-disclaimers-confirmed'
function isDisclaimerConfirmed(pluginId: string): boolean {
  try {
    return JSON.parse(localStorage.getItem(DISCLAIMER_KEY) ?? '[]').includes(pluginId)
  } catch {
    return false
  }
}
function markDisclaimerConfirmed(pluginId: string): void {
  try {
    const list: string[] = JSON.parse(localStorage.getItem(DISCLAIMER_KEY) ?? '[]')
    if (!list.includes(pluginId)) {
      localStorage.setItem(DISCLAIMER_KEY, JSON.stringify([...list, pluginId]))
    }
  } catch { /* 存不了就每次重新确认，无害 */ }
}

type LoginStep = 'type' | 'credentials' | 'plugin-disclaimer' | 'plugin-auth'

export default function LoginPage() {
  const { t } = useT()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { servers, addServer, activateServer, connectServer, setPrimaryServer, updateServerAuth, updatePluginServer, removeServer } = useServerStore()
  const activeServerId = useServerStore(state => state.activeServerId)

  const [step, setStep] = useState<LoginStep>('type')
  const [selectedType, setSelectedType] = useState<ServerType | null>(null)
  const [form, setForm] = useState({ url: '', username: '', password: '', name: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // 插件音源：选中项 + 完整 manifest + 预登录沙箱
  const plugins = usePluginStore(s => s.plugins)
  const pluginsLoaded = usePluginStore(s => s.loaded)
  const loadPlugins = usePluginStore(s => s.load)
  const [selectedPlugin, setSelectedPlugin] = useState<InstalledPluginSummary | null>(null)
  const [pluginManifest, setPluginManifest] = useState<PluginManifest | null>(null)
  const [authHost, setAuthHost] = useState<PluginHost | null>(null)
  const [addDialogOpen, setAddDialogOpen] = useState(false)

  useEffect(() => {
    void loadPlugins()
  }, [loadPlugins])

  // 扫码中途路由跳走（浏览器返回 / 深链）时拆掉预登录沙箱，
  // 否则二维码 iframe 和消息监听会活到下次刷新
  useEffect(() => () => {
    const current = usePluginStore.getState().plugins
    for (const p of current) closeAuthHost(p.id)
  }, [])

  // 声明文案在选中插件时随 manifest 一起取回
  const disclaimerText = pluginManifest?.disclaimer ?? ''

  /**
   * 进扫码步。notice 是「为什么会到这一步」（重新登录时是「登录已过期」）：
   * 它必须由调用方带进来——这一步开头要清掉上一次的报错，顺手就会把刚设的
   * 提示一起清掉，于是用户在扫码页上看不到任何解释。
   */
  const openPluginAuth = async (plugin: InstalledPluginSummary, notice = '') => {
    setError(notice)
    try {
      const installed = await usePluginStore.getState().getInstalled(plugin.id)
      if (!installed) throw new Error(t('sources.errorNotInstalled'))
      const manifest = installed.manifest as unknown as PluginManifest
      const host = await openAuthHost(plugin.id)
      setSelectedPlugin(plugin)
      setPluginManifest(manifest)
      setAuthHost(host)
      setStep('plugin-auth')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handlePluginSelect = (plugin: InstalledPluginSummary, notice = '') => {
    setSelectedPlugin(plugin)
    setPluginManifest(null)
    setAuthHost(null)
    setError(notice)
    void (async () => {
      const installed = await usePluginStore.getState().getInstalled(plugin.id)
      if (!installed) {
        setError(t('sources.errorNotInstalled'))
        return
      }
      const manifest = installed.manifest as unknown as PluginManifest
      setPluginManifest(manifest)
      if (isDisclaimerConfirmed(plugin.id)) {
        await openPluginAuth(plugin, notice)
      } else {
        setStep('plugin-disclaimer')
      }
    })()
  }

  /*
   * /login?plugin=<id>&relogin=1 —— 横幅与音源设置的「重新登录」都走这个地址，
   * 进页直达该插件的扫码步。
   *
   * 此前那两处只是 navigate('/login')：用户回到登录页，点自己那一行网易云，
   * 走的是「快速连接」——而插件的 connectServer 只装载沙箱、从不校验凭据，
   * 必然成功，于是回到首页、凭据还是坏的、横幅还在。原地打转。
   */
  const reloginPluginId = searchParams.get('relogin') === '1' ? searchParams.get('plugin') : null
  const reloginHandled = useRef(false)

  useEffect(() => {
    if (!reloginPluginId || reloginHandled.current || !pluginsLoaded) return
    reloginHandled.current = true
    const plugin = plugins.find(p => p.id === reloginPluginId)
    // 插件已被卸载：明说，别把人留在一个什么都没发生的登录页上
    if (!plugin) {
      setError(t('sources.errorNotInstalled'))
      return
    }
    handlePluginSelect(plugin, t('sources.expiredRelogin'))
    // handlePluginSelect 每次渲染都是新的闭包，进依赖数组会让这段反复触发；
    // 真正的触发条件只有「地址里的插件」与「插件表读完了」这两件事
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloginPluginId, pluginsLoaded, plugins])

  /** 扫码 / Cookie / 匿名殊途同归：凭据落 serverStore 并激活。
   *  同插件同账号复用已有条目；仅有的一条旧条目（比如匿名）原地升级 ——
   *  不然每次「先不登录」/重登都会堆出一行重复的音源 */
  const finishPluginAuth = async (credentials: string | null) => {
    if (!selectedPlugin) return
    setIsLoading(true)
    try {
      /*
       * 昵称是锦上添花，绝不能挡住登录完成。
       *
       * getUser 会真的发一次网络请求（网易云要打账号接口）。它慢、被风控、
       * 或者干脆不返回时，宿主要等满 30 秒的调用超时——用户那边看到的是
       * 「二维码已确认，然后就没有然后了」。所以这里自己加一道更短的闸：
       * 到点就带着空昵称继续，音源照常连上，昵称等下次体检时再补。
       */
      const NICKNAME_TIMEOUT_MS = 4000
      let nickname: string | null = null
      if (credentials && authHost?.hasMethod('n1ko.auth.getUser')) {
        try {
          const user = await Promise.race([
            authHost.call<PluginUser | null>('n1ko.auth.getUser'),
            new Promise<null>(resolve => setTimeout(() => resolve(null), NICKNAME_TIMEOUT_MS)),
          ])
          nickname = user?.name ?? null
        } catch { /* 取不到昵称不拦登录 */ }
      }
      const display = {
        name: nickname ? `${selectedPlugin.name} · ${nickname}` : selectedPlugin.name,
        // 匿名进入时这一行原来直接写着 'anonymous'——一个没翻译的英文词，
        // 而且它会作为「用户名」出现在登录页与设置里给人看。
        // 有凭据但此刻没拿到昵称（预登录沙箱问不到，见 serverStore.refreshPluginProfile）
        // 先写「已登录」，连上后由 refreshPluginProfile 换成真名。
        username: nickname ?? (credentials ? t('sources.signedIn') : t('sources.notSignedIn')),
      }
      const pluginRows = servers.filter(s => s.type === 'plugin' && s.pluginId === selectedPlugin.id)
      const matched = pluginRows.find(s => (s.credentials ?? null) === (credentials ?? null))
      // 正式登录优先升级一条匿名旧行，而不是再堆一行；匿名进入时 matched 已兜住重复
      const upgrade = matched || !credentials ? undefined : pluginRows.find(s => !s.credentials)
      const target = matched ?? upgrade ?? (pluginRows.length === 1 ? pluginRows[0] : undefined)
      let serverId: string
      if (target) {
        updatePluginServer(target.id, { ...display, ...(credentials ? { credentials } : {}) })
        serverId = target.id
      } else {
        serverId = addServer({
          type: 'plugin',
          pluginId: selectedPlugin.id,
          name: display.name,
          url: '',
          username: display.username,
          token: '',
          ...(credentials ? { credentials } : {}),
          isActive: true,
        })
      }
      /*
       * 沙箱要留到连接结束之后再拆。
       *
       * 这里原本先 setAuthHost(null) 再连接——而 plugin-auth 那一步的渲染
       * 条件里带着 authHost，一置空，加载指示和错误区就连同整块一起从页面
       * 消失了。于是「二维码确认成功之后什么也没发生」：连接慢时没有转圈，
       * 连接失败时错误无处显示，用户只能干等在一个空白的登录页上。
       */
      /*
       * 只**连接**，不夺主库。
       *
       * 此前这里走的是 activateServer = connectServer + setPrimaryServer，
       * 于是「加一个流媒体音源」的副作用是「换掉整个 App」：
       * setPrimaryServer 会 resetForServerChange（清空队列、当前曲、历史）
       * 并 queryClient.clear()，而插件不声明 libraryBrowse，
       * 曲库/专辑/歌手三页当场变成「没有可浏览的音源」。
       * 用户以为自己加了个音源，实际是音乐停了、首页空了一半。
       *
       * 主库只在**一个都还没有**时才由新音源担任（没有 NAS 的用户正是这种）。
       */
      const connected = await connectServer(serverId)
      closeAuthHost(selectedPlugin.id)
      setAuthHost(null)
      if (!connected) {
        setError(t('login.errorFailed'))
        return
      }
      if (!activeServerId) setPrimaryServer(serverId)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }

  /**
   * 「这份凭据还活着吗」——只在拿到明确否定答复时才拦。
   *
   * 用的是该音源自己的沙箱：登录页的预登录沙箱（openAuthHost）是空凭据的，
   * 拿它问 getUser 只会得到 null，等于把每一次快速连接都判成过期。沙箱还没
   * 装载时先 connectServer 把它装上——activateServer 本来第一步也是这个。
   *
   * 4 秒没答复就放行：getUser 会真打一次网络请求（风控、弱网都可能让它拖到
   * 宿主那 30 秒的调用超时），慢不等于坏，不能让一次抖动把人挡在自己的音源外。
   */
  const pluginCredentialsExpired = async (serverId: string): Promise<boolean> => {
    const PROBE_TIMEOUT_MS = 4000
    let host = getPluginHost(serverId)
    if (!host) {
      // 连不上是另一回事（插件被卸载等），交给后面的 activateServer 去报
      if (!(await connectServer(serverId))) return false
      host = getPluginHost(serverId)
    }
    if (!host?.hasMethod('n1ko.auth.getUser')) return false
    try {
      const user = await Promise.race([
        host.call<PluginUser | null>('n1ko.auth.getUser'),
        new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), PROBE_TIMEOUT_MS)),
      ])
      // null = 插件明说「这份凭据没有账号」；'timeout' 是「不知道」，按活的算
      return user === null
    } catch (err) {
      // 协议里 unauthorized 就是「要重新登录」，其它错误码都不是凭据的问题
      return (err as { code?: string } | null)?.code === 'unauthorized'
    }
  }

  const handleQuickConnect = async (serverId: string) => {
    /*
     * 插件音源要先验凭据再连。
     *
     * connectServer 对插件只是装载沙箱、从不校验凭据，必然返回 true——
     * 于是凭据早就过期的网易云也能「连接成功」，用户被送回首页，
     * 收藏和推荐依旧空着，失效横幅依旧挂着。这里把那一步补上：
     * 明确失效就直接进扫码，不再假装连上了。
     */
    const target = servers.find(s => s.id === serverId)
    if (target?.type === 'plugin' && target.pluginId && target.credentials) {
      const plugin = plugins.find(p => p.id === target.pluginId)
      if (plugin && (await pluginCredentialsExpired(serverId))) {
        handlePluginSelect(plugin, t('sources.expiredRelogin'))
        return
      }
    }

    /*
     * 插件行与 finishPluginAuth 同一条规则：只连接、不夺主库（主库只在一个都
     * 没有时才由它担任）。此前这里仍走 activateServer，已连着 NAS 时点一下
     * 自己的网易云就会 setPrimaryServer → 清队列、清缓存、曲库三页变空。
     * NAS 行保持「切换到这台服务器」的老语义——那才是用户点它的目的。
     */
    if (target?.type === 'plugin') {
      if (await connectServer(serverId)) {
        if (!activeServerId) setPrimaryServer(serverId)
        navigate('/')
        return
      }
    } else if (await activateServer(serverId)) {
      navigate('/')
      return
    }
    // 旧版 Jellyfin/Emby 凭据已失效：预填表单引导重新登录
    if (target && target.type !== 'plugin') {
      setSelectedType(target.type)
      setForm({ url: target.url, username: target.username, password: '', name: target.name })
      setStep('credentials')
      setError(t('login.errorCredentialsUpgraded'))
      return
    }
    // 插件音源连不上（插件被卸载、沙箱装载失败）：填表单没有意义，直说
    if (target) setError(t('login.errorFailed'))
  }

  const handleTypeSelect = (type: ServerType) => {
    setSelectedType(type)
    setStep('credentials')
    setError('')
  }

  const handleConnect = async () => {
    if (!selectedType || !form.url || !form.username || !form.password) {
      setError(t('login.errorRequired'))
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const url = form.url.replace(/\/$/, '')

      // 临时适配器走工厂：登录验证只需要 login()，不在这里 new 具体类
      const tempAdapter = createAdapter({
        id: 'login-temp',
        name: '',
        type: selectedType,
        url,
        username: form.username,
        token: '',
        isActive: false,
        createdAt: 0,
      })
      const result = await tempAdapter.login(url, form.username, form.password)
      if (!result.success) {
        setError(result.error || t('login.errorFailed'))
        return
      }

      const typeLabel = getServerTypeLabel(selectedType)
      const serverId = addServer({
        name: form.name || `${typeLabel} - ${new URL(url).hostname}`,
        type: selectedType,
        url,
        username: form.username,
        ...(selectedType === 'subsonic' || selectedType === 'navidrome'
          ? { token: result.token, salt: result.salt }
          : { token: result.token, userId: result.userId }),
        isActive: true,
      })
      if (selectedType === 'subsonic' || selectedType === 'navidrome') {
        updateServerAuth(serverId, result.token, result.salt)
      }
      if (!(await activateServer(serverId))) {
        setError(t('login.errorFailed'))
        return
      }

      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.errorNetwork'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md animate-fade-in">
        {/* 品牌报头：下缘 3px double 发丝线（同主报头范式） */}
        <header className="mb-12 pb-5 border-b-[3px] border-double border-hair text-center">
          <p className="font-sans text-[14px] font-bold tracking-[0.34em] text-foreground">
            N1KO MUSIC
          </p>
          <p className="num mt-1.5 text-[10.5px] tracking-[0.24em] text-ink-faint">
            PERSONAL MUSIC CLIENT
          </p>
        </header>

        <h1 className="text-center font-serif text-[28px] font-bold tracking-[-0.01em] text-foreground">
          {t('login.title')}
        </h1>
        <p className="mt-3 mb-10 text-center text-[13.5px] leading-relaxed text-ink-soft">
          {step === 'type'
            ? t('login.subtitleChooseType')
            : step === 'credentials'
              ? t('login.subtitleConfiguring', {
                  type: SERVER_TYPES.find(item => item.type === selectedType)?.label ?? '',
                })
              : step === 'plugin-disclaimer'
                ? t('sources.subtitleDisclaimer', { name: selectedPlugin?.name ?? '' })
                : t('sources.subtitleAuth', { name: selectedPlugin?.name ?? '' })}
        </p>

        {/*
          错误区放在所有步骤之外。
          此前它只写在「填连接信息」和「扫码」两步里，于是类型选择步与声明
          确认步 setError 之后页面毫无反应——插件登录出问题时用户完全查不出
          发生了什么（三个阶段的报告里都记着「已记未修」，这里一并解决）。
        */}
        {error && (
          <p className="mb-5 border-l-2 border-destructive pl-3 text-[13px] leading-relaxed text-destructive">
            {error}
          </p>
        )}

        {step === 'plugin-disclaimer' && selectedPlugin && (
          <PluginDisclaimer
            pluginName={selectedPlugin.name}
            disclaimer={disclaimerText}
            onConfirm={() => {
              markDisclaimerConfirmed(selectedPlugin.id)
              void openPluginAuth(selectedPlugin)
            }}
            onCancel={() => setStep('type')}
          />
        )}

        {step === 'plugin-auth' && selectedPlugin && authHost && pluginManifest && (
          <div className="space-y-5 border-t border-hair pt-7">
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => {
                  closeAuthHost(selectedPlugin.id)
                  setAuthHost(null)
                  setStep('type')
                }}
                className="inline-flex items-center gap-1.5 text-[12.5px] tracking-[0.08em] text-ink-soft hover:text-primary transition-colors"
              >
                <ArrowLeft size={13} />
                {t('action.back')}
              </button>
              <span className="text-ink-faint">·</span>
              <span className="font-serif text-[14px] font-semibold text-foreground">
                {selectedPlugin.name}
              </span>
            </div>

            {isLoading ? (
              <p className="flex items-center justify-center gap-2 py-10 text-[13px] text-ink-soft">
                <CircleNotch size={15} className="animate-spin text-primary" />
                {t('login.connecting')}
              </p>
            ) : (
              <>
                {pluginManifest.auth.kind === 'qr' && (
                  <QrLogin
                    host={authHost}
                    qrHint={pluginManifest.auth.qrHint}
                    onAuthorized={credentials => void finishPluginAuth(credentials)}
                  />
                )}
                {pluginManifest.auth.kind === 'none' && (
                  <p className="py-6 text-center text-[13px] text-ink-soft">
                    {t('sources.authNone')}
                  </p>
                )}
                {/*
                  Cookie 登录只在插件真的能收 Cookie 时才摆出来。
                  此前它是无条件渲染的：auth.kind 为 'none' 的音源、以及没导出
                  n1ko.auth.loginWithCookie 的插件，页面上照样有一个「高级 ·
                  用 Cookie 登录」——展开、粘贴、点提交，换来一句
                  「unsupported」。摆出一个注定失败的入口比没有更糟。
                */}
                {pluginManifest.auth.kind !== 'none' && authHost.hasMethod('n1ko.auth.loginWithCookie') && (
                  <CookieLogin
                    host={authHost}
                    cookieHint={pluginManifest.auth.cookieHint}
                    onAuthorized={credentials => void finishPluginAuth(credentials)}
                  />
                )}
                {pluginManifest.auth.allowAnonymous && (
                  <div className="border-t border-hair-soft pt-4 text-center">
                    <button
                      onClick={() => void finishPluginAuth(null)}
                      className="text-[12.5px] text-ink-faint underline-offset-4 hover:text-primary hover:underline transition-colors"
                    >
                      {t('sources.anonymous')}
                    </button>
                  </div>
                )}
              </>
            )}

          </div>
        )}

        {step === 'type' ? (
          <div>
            {/* 已保存的服务器：编号行式快速连接 */}
            {servers.length > 0 && (
              <div className="mb-10">
                <p className="mb-3 text-[11px] tracking-[0.24em] text-ink-faint">
                  {t('login.savedServers')}
                </p>
                <ol className="border-t border-hair">
                  {servers.map((server, i) => (
                    <li key={server.id} className="group/row relative border-b border-hair-soft">
                      <button
                        onClick={() => handleQuickConnect(server.id)}
                        className="flex w-full items-center gap-4 px-2 py-3 pr-11 text-left transition-all duration-200 hover:bg-paper-deep/60 hover:translate-x-1"
                      >
                        <span className="num w-6 flex-shrink-0 text-[11.5px] text-ink-faint transition-colors group-hover/row:text-primary">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-serif text-[15px] font-semibold text-foreground transition-colors group-hover/row:text-primary">
                            {server.name}
                          </span>
                          <span className="block truncate text-[11.5px] text-ink-faint">
                            {server.type === 'plugin'
                              ? plugins.find(p => p.id === server.pluginId)?.name ?? getServerTypeLabel(server.type)
                              : getServerTypeLabel(server.type)}
                            {' · '}
                            {/* 早先的匿名条目在盘上存的就是字面量 'anonymous'，
                                只改新写入的话老用户永远看着那个英文词 */}
                            {server.username === 'anonymous'
                              ? (server.credentials ? t('sources.signedIn') : t('sources.notSignedIn'))
                              : server.username}
                          </span>
                        </span>
                        <span className="num hidden sm:block max-w-[150px] truncate text-[10.5px] text-ink-faint">
                          {server.url}
                        </span>
                        <CaretRight
                          size={13}
                          className="flex-shrink-0 text-ink-faint transition-colors group-hover/row:text-primary"
                        />
                      </button>
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          if (window.confirm(t('login.removeSavedServerConfirm', { name: server.name }))) {
                            removeServer(server.id)
                          }
                        }}
                        aria-label={t('login.removeSavedServer')}
                        title={t('login.removeSavedServer')}
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-faint/50 transition-colors hover:bg-paper-deep hover:text-destructive"
                      >
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ol>
                <p className="pt-3 text-center text-[12px] text-ink-faint">{t('login.addNewServer')}</p>
              </div>
            )}

            {/* 服务器类型：发丝线行式单选（当前项 accent + 左 2px 竖线） */}
            <p className="mb-3 text-[11px] tracking-[0.24em] text-ink-faint">
              {t('login.serverType')}
            </p>
            <div className="border-t border-hair">
              {SERVER_TYPES.map(({ type, label, descKey }) => {
                const active = selectedType === type
                return (
                  <button
                    key={type}
                    onClick={() => handleTypeSelect(type)}
                    aria-pressed={active}
                    className={cn(
                      'group relative flex w-full items-center gap-4 border-b border-hair-soft py-3.5 pl-4 pr-2 text-left transition-all duration-200 hover:bg-paper-deep/60 hover:translate-x-1',
                      active && 'bg-paper-deep/50'
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'absolute left-0 top-0 h-full w-[2px] bg-primary transition-opacity duration-200',
                        active ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block font-serif text-[15.5px] font-semibold transition-colors',
                          active ? 'text-primary' : 'text-foreground group-hover:text-primary'
                        )}
                      >
                        {label}
                      </span>
                      <span className="block text-[12px] text-ink-faint">{t(descKey)}</span>
                    </span>
                    <CaretRight
                      size={13}
                      className="flex-shrink-0 text-ink-faint transition-colors group-hover:text-primary"
                    />
                  </button>
                )
              })}
            </div>

            {/* 流媒体音源：已安装插件 + 添加入口（PLAN 1.6） */}
            {/* 小标题整句进词条（同 login.savedServers / login.serverType 的写法）：
                这里原来在 JSX 里拼了一截硬编码的「· STREAMING」——那个后缀是版式的
                一部分，留在代码里等于把它排除在翻译之外 */}
            <p className="mt-10 mb-3 text-[11px] tracking-[0.24em] text-ink-faint">
              {t('sources.group')}
            </p>
            {/*
              正式版的纯浏览器没有能带 Cookie 的出网通道（见 lib/platform 的
              pluginSourcesSupported）：登录流程本身走得完，之后每一次取歌、
              取歌单都会失败。摆出一个注定失败的登录入口比没有更糟——
              这里换成一句「需要哪个版本」加下载链接。
            */}
            {!pluginSourcesSupported ? (
              <p className="border-t border-hair pt-4 text-[12.5px] leading-relaxed text-ink-soft">
                {t('sources.needsApp')}{' '}
                <a
                  href={RELEASES_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary underline decoration-hair underline-offset-[5px] hover:decoration-primary"
                >
                  {t('sources.needsAppLink')}
                </a>
              </p>
            ) : (
              <div className="border-t border-hair">
                {plugins.map(plugin => (
                  <button
                    key={plugin.id}
                    onClick={() => handlePluginSelect(plugin)}
                    className="group flex w-full items-center gap-4 border-b border-hair-soft py-3.5 pl-4 pr-2 text-left transition-all duration-200 hover:bg-paper-deep/60 hover:translate-x-1"
                  >
                    {pluginLogoSrc(plugin.id) ? (
                      <SourceLogo pluginId={plugin.id} size={22} className="ring-1 ring-hair-soft" />
                    ) : (
                      <span
                        aria-hidden
                        className="h-[22px] w-[22px] flex-shrink-0 rounded-[5px] border border-hair"
                        style={plugin.color ? { background: plugin.color } : undefined}
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block font-serif text-[15.5px] font-semibold text-foreground transition-colors group-hover:text-primary">
                        {plugin.name}
                      </span>
                      {/* 这里原本写的是 plugin.platform——manifest 里的内部标识
                          （'netease' / 'qqmusic' 这种），它对用户没有意义，
                          暴露的只是实现细节。名字在上一行已经有了，这一行
                          换成「它是什么 + 哪一版」。 */}
                      <span className="num block text-[12px] text-ink-faint">
                        {t('sources.typeLabel')} · v{plugin.version}
                      </span>
                    </span>
                    <CaretRight
                      size={13}
                      className="flex-shrink-0 text-ink-faint transition-colors group-hover:text-primary"
                    />
                  </button>
                ))}
                <button
                  onClick={() => setAddDialogOpen(true)}
                  className="group flex w-full items-center gap-4 border-b border-hair-soft py-3.5 pl-4 pr-2 text-left transition-all duration-200 hover:bg-paper-deep/60 hover:translate-x-1"
                >
                  <Plus size={15} className="flex-shrink-0 text-ink-faint transition-colors group-hover:text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] text-ink-soft transition-colors group-hover:text-primary">
                      {t('sources.addPlugin')}
                    </span>
                    <span className="block text-[12px] text-ink-faint">{t('sources.addPluginDesc')}</span>
                  </span>
                </button>
              </div>
            )}
          </div>
        ) : step === 'credentials' ? (
          /* 填写连接信息 */
          <div className="space-y-5 border-t border-hair pt-7">
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => setStep('type')}
                className="inline-flex items-center gap-1.5 text-[12.5px] tracking-[0.08em] text-ink-soft hover:text-primary transition-colors"
              >
                <ArrowLeft size={13} />
                {t('action.back')}
              </button>
              <span className="text-ink-faint">·</span>
              <span className="font-serif text-[14px] font-semibold text-foreground">
                {SERVER_TYPES.find(item => item.type === selectedType)?.label}
              </span>
            </div>

            {/* 服务器名称（可选）*/}
            <div>
              <label htmlFor="login-name" className="mb-1.5 block text-[11px] tracking-[0.18em] text-ink-faint">
                {t('login.serverName')}
              </label>
              <Input
                id="login-name"
                placeholder={t('login.serverNamePlaceholder')}
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            {/* 服务器地址 */}
            <div>
              <label htmlFor="login-url" className="mb-1.5 block text-[11px] tracking-[0.18em] text-ink-faint">
                {t('login.serverUrl')} <span className="text-destructive">*</span>
              </label>
              <Input
                id="login-url"
                placeholder="https://music.example.com"
                value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                type="url"
                required
                inputMode="url"
                autoComplete="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>

            {/* 用户名 */}
            <div>
              <label htmlFor="login-username" className="mb-1.5 block text-[11px] tracking-[0.18em] text-ink-faint">
                {t('login.username')} <span className="text-destructive">*</span>
              </label>
              {/*
                autoCapitalize="none" 不是可有可无：iOS 默认把每个字段的首字母
                大写，用户输入 admin 会得到 Admin，而 Navidrome / Subsonic 的
                用户名区分大小写——第一次连接就会失败，且看不出哪里错了。
                autoComplete 让密码管理器认得出这是哪一组凭据。
              */}
              <Input
                id="login-username"
                placeholder="admin"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                required
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>

            {/* 密码 */}
            <div>
              <label htmlFor="login-password" className="mb-1.5 block text-[11px] tracking-[0.18em] text-ink-faint">
                {t('login.password')} <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <Input
                  id="login-password"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  type={showPassword ? 'text' : 'password'}
                  onKeyDown={e => e.key === 'Enter' && handleConnect()}
                  className="pr-10"
                  required
                  autoComplete="current-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-foreground transition-colors duration-200"
                  aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                >
                  {showPassword ? <EyeSlash size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* 连接按钮：文字级主操作 + 下划线（DESIGN §4.1） */}
            <div className="pt-2 text-center">
              <Button
                onClick={handleConnect}
                disabled={isLoading || !form.url || !form.username || !form.password}
              >
                {isLoading ? (
                  <>
                    <CircleNotch className="w-4 h-4 mr-2 animate-spin" />
                    {t('login.connecting')}
                  </>
                ) : (
                  t('login.connect')
                )}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {/* 添加插件（目录 / URL / 粘贴）：无 NAS 的首跑用户装第一个音源就靠它 */}
      <AddPluginDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
    </div>
  )
}
