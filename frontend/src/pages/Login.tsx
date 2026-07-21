/**
 * 服务器登录页
 * 支持 Subsonic/Navidrome/Jellyfin/Emby 四种服务器类型
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Waveform, CircleNotch, Eye, EyeSlash, CaretRight, HardDrives, MusicNote } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useServerStore, getServerTypeLabel } from '@/store/serverStore'
import { SubsonicAdapter } from '@/api/adapters/subsonic'
import { JellyfinAdapter } from '@/api/adapters/jellyfin'
import { EmbyAdapter } from '@/api/adapters/emby'
import { setActiveAdapter } from '@/api'
import type { ServerType } from '@/api/types'

const SERVER_TYPES: Array<{ type: ServerType; label: string; desc: string }> = [
  { type: 'navidrome', label: 'Navidrome', desc: '开源音乐服务器（推荐）' },
  { type: 'subsonic', label: 'Subsonic', desc: '经典 Subsonic 兼容服务器' },
  { type: 'jellyfin', label: 'Jellyfin', desc: '开源媒体服务器' },
  { type: 'emby', label: 'Emby', desc: '多媒体服务器' },
]

export default function LoginPage() {
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
      setError('登录凭据已升级，请重新输入密码完成连接')
    }
  }

  const handleTypeSelect = (type: ServerType) => {
    setSelectedType(type)
    setStep('credentials')
    setError('')
  }

  const handleConnect = async () => {
    if (!selectedType || !form.url || !form.username || !form.password) {
      setError('请填写所有必填字段')
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
          setError(result.error || '连接失败，请检查服务器地址和账号密码')
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
          setError(result.error || '连接失败，请检查服务器地址和账号密码')
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
      setError(err instanceof Error ? err.message : '连接失败，请检查网络或服务器地址')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      {/* 背景氛围光 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md animate-fade-in">
        {/* 品牌 */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-primary to-primary/50 flex items-center justify-center mb-4 shadow-lg">
            <Waveform weight="fill" className="w-7 h-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">N1KO MUSIC</h1>
          <p className="text-sm text-muted-foreground mt-1.5">连接到你的音乐服务器</p>
        </div>

        {step === 'type' ? (
          /* 选择服务器类型 */
          <div className="space-y-2">
            {servers.length > 0 && (
              <div className="mb-8 space-y-2">
                <p className="text-xs font-medium text-muted-foreground tracking-widest text-center mb-3">
                  已保存的服务器
                </p>
                {servers.map(server => (
                  <button
                    key={server.id}
                    onClick={() => handleQuickConnect(server.id)}
                    className="w-full flex items-center gap-4 px-4 py-3.5 rounded-lg border border-border hover:border-primary transition-colors duration-150 group text-left active:scale-[0.98]"
                  >
                    <div className="w-9 h-9 rounded-md bg-accent flex items-center justify-center flex-shrink-0 text-muted-foreground group-hover:text-primary transition-colors duration-150">
                      <MusicNote size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-foreground truncate">{server.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{server.url}</p>
                      <p className="text-xs text-muted-foreground">{getServerTypeLabel(server.type)} · {server.username}</p>
                    </div>
                    <CaretRight size={16} className="text-muted-foreground group-hover:text-primary transition-colors duration-150 flex-shrink-0" />
                  </button>
                ))}
                <p className="text-xs text-muted-foreground text-center pt-2">或添加新服务器</p>
              </div>
            )}
            <p className="text-xs font-medium text-muted-foreground tracking-widest text-center mb-3">
              选择服务器类型
            </p>
            {SERVER_TYPES.map(({ type, label, desc }) => (
              <button
                key={type}
                onClick={() => handleTypeSelect(type)}
                className="w-full flex items-center gap-4 px-4 py-3.5 rounded-lg border border-border hover:border-primary transition-colors duration-150 group text-left active:scale-[0.98]"
              >
                <div className="w-9 h-9 rounded-md bg-accent flex items-center justify-center flex-shrink-0 text-muted-foreground group-hover:text-primary transition-colors duration-150">
                  <HardDrives size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground">{label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                </div>
                <CaretRight size={16} className="text-muted-foreground group-hover:text-primary transition-colors duration-150 flex-shrink-0" />
              </button>
            ))}
          </div>
        ) : (
          /* 填写连接信息 */
          <div className="border-t border-border pt-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => setStep('type')}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-150"
              >
                ← 返回
              </button>
              <span className="text-sm text-muted-foreground">·</span>
              <span className="text-sm font-medium text-foreground capitalize">
                {SERVER_TYPES.find(t => t.type === selectedType)?.label}
              </span>
            </div>

            {/* 服务器名称（可选）*/}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                服务器名称（可选）
              </label>
              <Input
                placeholder="我的 Navidrome"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            {/* 服务器地址 */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                服务器地址 <span className="text-destructive">*</span>
              </label>
              <Input
                placeholder="https://music.example.com"
                value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                type="url"
              />
            </div>

            {/* 用户名 */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                用户名 <span className="text-destructive">*</span>
              </label>
              <Input
                placeholder="admin"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              />
            </div>

            {/* 密码 */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                密码 <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <Input
                  placeholder="••••••••"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  type={showPassword ? 'text' : 'password'}
                  onKeyDown={e => e.key === 'Enter' && handleConnect()}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors duration-150"
                >
                  {showPassword ? <EyeSlash size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* 错误提示 */}
            {error && (
              <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
                {error}
              </p>
            )}

            {/* 连接按钮 */}
            <Button
              className="w-full h-10 font-semibold"
              onClick={handleConnect}
              disabled={isLoading || !form.url || !form.username || !form.password}
            >
              {isLoading ? (
                <>
                  <CircleNotch className="w-4 h-4 mr-2 animate-spin" />
                  正在连接...
                </>
              ) : (
                '连接服务器'
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
