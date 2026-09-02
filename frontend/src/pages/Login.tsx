/**
 * 服务器登录页 —— 纸面杂志化（DESIGN v2 §4.4/§4.5）
 * 居中窄栏：品牌报头 + 衬线大标题；服务器类型为发丝线行式单选，
 * 已存服务器为编号行式快速连接；错误直接陈述
 * NAS：Subsonic/Navidrome/Jellyfin/Emby；流媒体音源：已安装插件（PLAN 1.6）
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CaretRight, CircleNotch, Eye, EyeSlash, Plus } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useServerStore, getServerTypeLabel } from '@/store/serverStore'
import { createAdapter } from '@/api'
import type { ServerType } from '@/api/types'
import { useT } from '@/i18n'
import { usePluginStore, type InstalledPluginSummary } from '@/plugins/host/pluginStore'
import { closeAuthHost, openAuthHost } from '@/plugins/host/pluginRuntime'
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
  const { servers, addServer, activateServer, updateServerAuth } = useServerStore()

  const [step, setStep] = useState<LoginStep>('type')
  const [selectedType, setSelectedType] = useState<ServerType | null>(null)
  const [form, setForm] = useState({ url: '', username: '', password: '', name: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // 插件音源：选中项 + 完整 manifest + 预登录沙箱
  const plugins = usePluginStore(s => s.plugins)
  const loadPlugins = usePluginStore(s => s.load)
  const [selectedPlugin, setSelectedPlugin] = useState<InstalledPluginSummary | null>(null)
  const [pluginManifest, setPluginManifest] = useState<PluginManifest | null>(null)
  const [authHost, setAuthHost] = useState<PluginHost | null>(null)
  const [addDialogOpen, setAddDialogOpen] = useState(false)

  useEffect(() => {
    void loadPlugins()
  }, [loadPlugins])

  // 声明文案在选中插件时随 manifest 一起取回
  const disclaimerText = pluginManifest?.disclaimer ?? ''

  const openPluginAuth = async (plugin: InstalledPluginSummary) => {
    setError('')
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

  const handlePluginSelect = (plugin: InstalledPluginSummary) => {
    setSelectedPlugin(plugin)
    setPluginManifest(null)
    setAuthHost(null)
    setError('')
    void (async () => {
      const installed = await usePluginStore.getState().getInstalled(plugin.id)
      if (!installed) {
        setError(t('sources.errorNotInstalled'))
        return
      }
      const manifest = installed.manifest as unknown as PluginManifest
      setPluginManifest(manifest)
      if (isDisclaimerConfirmed(plugin.id)) {
        await openPluginAuth(plugin)
      } else {
        setStep('plugin-disclaimer')
      }
    })()
  }

  /** 扫码 / Cookie / 匿名殊途同归：凭据落 serverStore 并激活 */
  const finishPluginAuth = async (credentials: string | null) => {
    if (!selectedPlugin) return
    setIsLoading(true)
    try {
      let nickname: string | null = null
      if (credentials && authHost?.hasMethod('n1ko.auth.getUser')) {
        try {
          const user = await authHost.call<PluginUser | null>('n1ko.auth.getUser')
          nickname = user?.name ?? null
        } catch { /* 取不到昵称不拦登录 */ }
      }
      const serverId = addServer({
        type: 'plugin',
        pluginId: selectedPlugin.id,
        name: nickname ? `${selectedPlugin.name} · ${nickname}` : selectedPlugin.name,
        url: '',
        username: nickname ?? 'anonymous',
        token: '',
        ...(credentials ? { credentials } : {}),
        isActive: true,
      })
      closeAuthHost(selectedPlugin.id)
      setAuthHost(null)
      if (!(await activateServer(serverId))) {
        setError(t('login.errorFailed'))
        return
      }
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }

  const handleQuickConnect = async (serverId: string) => {
    if (await activateServer(serverId)) {
      navigate('/')
      return
    }
    // 旧版 Jellyfin/Emby 凭据已失效：预填表单引导重新登录
    const server = servers.find(s => s.id === serverId)
    if (server) {
      setSelectedType(server.type)
      setForm({ url: server.url, username: server.username, password: '', name: server.name })
      setStep('credentials')
      setError(t('login.errorCredentialsUpgraded'))
    }
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
                <CookieLogin
                  host={authHost}
                  cookieHint={pluginManifest.auth.cookieHint}
                  onAuthorized={credentials => void finishPluginAuth(credentials)}
                />
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

            {error && (
              <p className="border-l-2 border-destructive pl-3 text-[13px] leading-relaxed text-destructive">
                {error}
              </p>
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
                    <li key={server.id} className="border-b border-hair-soft">
                      <button
                        onClick={() => handleQuickConnect(server.id)}
                        className="group flex w-full items-center gap-4 px-2 py-3 text-left transition-all duration-200 hover:bg-paper-deep/60 hover:translate-x-1"
                      >
                        <span className="num w-6 flex-shrink-0 text-[11.5px] text-ink-faint transition-colors group-hover:text-primary">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-serif text-[15px] font-semibold text-foreground transition-colors group-hover:text-primary">
                            {server.name}
                          </span>
                          <span className="block truncate text-[11.5px] text-ink-faint">
                            {getServerTypeLabel(server.type)} · {server.username}
                          </span>
                        </span>
                        <span className="num hidden sm:block max-w-[150px] truncate text-[10.5px] text-ink-faint">
                          {server.url}
                        </span>
                        <CaretRight
                          size={13}
                          className="flex-shrink-0 text-ink-faint transition-colors group-hover:text-primary"
                        />
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
            <p className="mt-10 mb-3 text-[11px] tracking-[0.24em] text-ink-faint">
              {t('sources.group')} · STREAMING
            </p>
            <div className="border-t border-hair">
              {plugins.map(plugin => (
                <button
                  key={plugin.id}
                  onClick={() => handlePluginSelect(plugin)}
                  className="group flex w-full items-center gap-4 border-b border-hair-soft py-3.5 pl-4 pr-2 text-left transition-all duration-200 hover:bg-paper-deep/60 hover:translate-x-1"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-serif text-[15.5px] font-semibold text-foreground transition-colors group-hover:text-primary">
                      {plugin.name}
                    </span>
                    <span className="num block text-[12px] text-ink-faint">
                      {plugin.platform} · v{plugin.version}
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

            {/* 错误提示：直接陈述，左侧 2px 竖线 */}
            {error && (
              <p className="border-l-2 border-destructive pl-3 text-[13px] leading-relaxed text-destructive">
                {error}
              </p>
            )}

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
