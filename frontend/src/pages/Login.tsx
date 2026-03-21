/**
 * 服务器登录页
 * 支持 Subsonic/Navidrome/Jellyfin/Emby 四种服务器类型
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Music2, Loader2, Eye, EyeOff, ChevronRight, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useServerStore } from '@/store/serverStore'
import { SubsonicAdapter } from '@/api/adapters/subsonic'
import { JellyfinAdapter } from '@/api/adapters/jellyfin'
import { EmbyAdapter } from '@/api/adapters/emby'
import { setActiveAdapter } from '@/api'
import type { ServerType } from '@/api/types'
import { cn } from '@/lib/utils'

const SERVER_TYPES: Array<{ type: ServerType; label: string; desc: string; color: string }> = [
  { type: 'navidrome', label: 'Navidrome', desc: '开源音乐服务器（推荐）', color: 'from-blue-600 to-blue-800' },
  { type: 'subsonic', label: 'Subsonic', desc: '经典 Subsonic 兼容服务器', color: 'from-purple-600 to-purple-800' },
  { type: 'jellyfin', label: 'Jellyfin', desc: '开源媒体服务器', color: 'from-teal-600 to-teal-800' },
  { type: 'emby', label: 'Emby', desc: '多媒体服务器', color: 'from-green-600 to-green-800' },
]

export default function LoginPage() {
  const navigate = useNavigate()
  const { addServer, activateServer, updateServerAuth } = useServerStore()

  const [step, setStep] = useState<'type' | 'credentials'>('type')
  const [selectedType, setSelectedType] = useState<ServerType | null>(null)
  const [form, setForm] = useState({ url: '', username: '', password: '', name: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

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
      {/* 背景装饰 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full rounded-full bg-primary/3 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mb-4">
            <Music2 className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">N1KO MUSIC</h1>
          <p className="text-sm text-muted-foreground mt-1">连接到你的音乐服务器</p>
        </div>

        {step === 'type' ? (
          /* 选择服务器类型 */
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground mb-4 text-center">
              选择服务器类型
            </p>
            {SERVER_TYPES.map(({ type, label, desc, color }) => (
              <button
                key={type}
                onClick={() => handleTypeSelect(type)}
                className="w-full flex items-center gap-4 p-4 rounded-2xl border border-border bg-card hover:bg-accent transition-all group"
              >
                <div className={cn('w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center flex-shrink-0', color)}>
                  <Server className="w-5 h-5 text-white" />
                </div>
                <div className="text-left flex-1">
                  <p className="font-semibold text-sm text-foreground">{label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              </button>
            ))}
          </div>
        ) : (
          /* 填写连接信息 */
          <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => setStep('type')}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
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
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* 错误提示 */}
            {error && (
              <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
                {error}
              </p>
            )}

            {/* 连接按钮 */}
            <Button
              className="w-full"
              onClick={handleConnect}
              disabled={isLoading || !form.url || !form.username || !form.password}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
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
