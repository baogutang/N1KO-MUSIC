/**
 * 服务器登录页 —— 纸面杂志化（DESIGN v2 §4.4/§4.5）
 * 居中窄栏：品牌报头 + 衬线大标题；服务器类型为发丝线行式单选，
 * 已存服务器为编号行式快速连接；错误直接陈述
 * 支持 Subsonic/Navidrome/Jellyfin/Emby 四种服务器类型
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CaretRight, CircleNotch, Eye, EyeSlash } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useServerStore, getServerTypeLabel } from '@/store/serverStore'
import { SubsonicAdapter } from '@/api/adapters/subsonic'
import { JellyfinAdapter } from '@/api/adapters/jellyfin'
import { EmbyAdapter } from '@/api/adapters/emby'
import { setActiveAdapter } from '@/api'
import type { ServerType } from '@/api/types'
import { useT } from '@/i18n'

// 说明句只存 key：这张表在模块加载时就建好了，直接存译文会把语言钉死在首次加载那一刻
const SERVER_TYPES: Array<{ type: ServerType; label: string; descKey: string }> = [
  { type: 'navidrome', label: 'Navidrome', descKey: 'login.type.navidrome' },
  { type: 'subsonic', label: 'Subsonic', descKey: 'login.type.subsonic' },
  { type: 'jellyfin', label: 'Jellyfin', descKey: 'login.type.jellyfin' },
  { type: 'emby', label: 'Emby', descKey: 'login.type.emby' },
]

export default function LoginPage() {
  const { t } = useT()
  const navigate = useNavigate()
  const { servers, addServer, activateServer, updateServerAuth } = useServerStore()

  const [step, setStep] = useState<'type' | 'credentials'>('type')
  const [selectedType, setSelectedType] = useState<ServerType | null>(null)
  const [form, setForm] = useState({ url: '', username: '', password: '', name: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleQuickConnect = (serverId: string) => {
    if (activateServer(serverId)) {
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
      let adapter: SubsonicAdapter | JellyfinAdapter | EmbyAdapter
      let result

      const url = form.url.replace(/\/$/, '')

      if (selectedType === 'subsonic' || selectedType === 'navidrome') {
        // Subsonic 先创建临时适配器测试
        const tempAdapter = new SubsonicAdapter({
          url,
          username: form.username,
          token: '',
          salt: '',
        })
        result = await tempAdapter.login(url, form.username, form.password)
        if (!result.success) {
          setError(result.error || t('login.errorFailed'))
          return
        }
        adapter = new SubsonicAdapter({
          url,
          username: form.username,
          token: result.token,
          salt: result.salt ?? '',
        })
        setActiveAdapter(adapter)

        const serverId = addServer({
          name: form.name || `${selectedType === 'navidrome' ? 'Navidrome' : 'Subsonic'} - ${new URL(url).hostname}`,
          type: selectedType,
          url,
          username: form.username,
          token: result.token,
          salt: result.salt,
          isActive: true,
        })
        updateServerAuth(serverId, result.token, result.salt)
        activateServer(serverId)
      } else {
        const AdapterClass = selectedType === 'jellyfin' ? JellyfinAdapter : EmbyAdapter
        const tempAdapter = new AdapterClass({ url, token: '', userId: '' })
        result = await tempAdapter.login(url, form.username, form.password)
        if (!result.success) {
          setError(result.error || t('login.errorFailed'))
          return
        }
        adapter = new AdapterClass({
          url,
          token: result.token,
          userId: result.userId ?? '',
        })
        setActiveAdapter(adapter)

        const serverId = addServer({
          name: form.name || `${selectedType === 'jellyfin' ? 'Jellyfin' : 'Emby'} - ${new URL(url).hostname}`,
          type: selectedType,
          url,
          username: form.username,
          token: result.token,
          userId: result.userId,
          isActive: true,
        })
        activateServer(serverId)
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
            : t('login.subtitleConfiguring', {
                type: SERVER_TYPES.find(item => item.type === selectedType)?.label ?? '',
              })}
        </p>

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
          </div>
        ) : (
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
        )}
      </div>
    </div>
  )
}
