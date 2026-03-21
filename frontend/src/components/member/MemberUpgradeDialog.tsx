/**
 * 会员升级引导弹窗
 * 只保留激活码输入，用户线下打款后由开发者发放激活码
 *
 * 激活流程：
 *   1. 用户联系开发者完成打款
 *   2. 开发者发放激活码
 *   3. 用户在此输入激活码完成激活
 */

import { useState } from 'react'
import { Crown, Zap, Music, Star, CheckCircle2, AlertCircle, X, KeyRound, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMemberStore } from '@/store/memberStore'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface MemberUpgradeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 触发弹窗的功能名称，用于个性化提示 */
  featureName?: string
}

const FEATURES = [
  { icon: Music, label: '无损原码 / 超高音质', desc: '支持 FLAC、无损原码等高品质格式' },
  { icon: Zap, label: '为你推荐', desc: '智能算法根据你的口味精选歌单' },
  { icon: Star, label: '我的收藏', desc: '跨设备同步收藏夹，随时随地听' },
  { icon: CheckCircle2, label: '听歌统计', desc: '详细播放数据，了解你的音乐偏好' },
]

// ─── 激活码输入面板 ───────────────────────────────────────────────────────────

function CodePanel({ onSuccess }: { onSuccess: () => void }) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  // 只订阅 activate 函数，避免 isPremium 等变化触发不必要的重渲染
  const activate = useMemberStore(s => s.activate)

  const handleActivate = async () => {
    if (!code.trim()) return
    setLoading(true)
    setResult(null)
    const res = await activate(code)
    setResult({ type: res.success ? 'success' : 'error', message: res.message })
    setLoading(false)
    if (res.success) {
      setTimeout(onSuccess, 1800)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/40 text-center">输入激活码即可解锁会员</p>
      <div className="relative">
        <input
          type="text"
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && handleActivate()}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          style={{ color: '#ffffff' }}
          className={cn(
            'w-full bg-white/10 border rounded-xl px-4 py-3 text-sm placeholder:text-white/30',
            'outline-none focus:ring-2 transition-all font-mono tracking-widest text-center caret-white',
            result?.type === 'error'
              ? 'border-red-500/50 focus:ring-red-500/30'
              : result?.type === 'success'
                ? 'border-green-500/50 focus:ring-green-500/30'
                : 'border-white/15 focus:ring-primary/40 focus:border-primary/50'
          )}
          disabled={loading}
        />
      </div>

      {result && (
        <div className={cn(
          'flex items-center gap-2 text-sm rounded-lg px-3 py-2',
          result.type === 'success'
            ? 'bg-green-500/15 text-green-400 border border-green-500/20'
            : 'bg-red-500/15 text-red-400 border border-red-500/20'
        )}>
          {result.type === 'success'
            ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
          <span>{result.message}</span>
        </div>
      )}

      <Button
        className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-semibold rounded-xl h-11 shadow-lg shadow-amber-500/20 border-0"
        onClick={handleActivate}
        disabled={loading || !code.trim()}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            验证中...
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <KeyRound className="w-4 h-4" />
            立即激活
          </span>
        )}
      </Button>
    </div>
  )
}

// ─── 主弹窗 ──────────────────────────────────────────────────────────────────

export function MemberUpgradeDialog({
  open,
  onOpenChange,
  featureName,
}: MemberUpgradeDialogProps) {
  const handleSuccess = () => {
    setTimeout(() => onOpenChange(false), 500)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden border-0 bg-transparent shadow-none [&>button]:hidden">
        <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-950 border border-white/10 shadow-2xl">
          {/* 装饰光晕 */}
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-amber-500/15 rounded-full blur-3xl pointer-events-none" />

          {/* 关闭按钮 */}
          <button
            onClick={() => onOpenChange(false)}
            className="absolute top-4 right-4 z-10 p-1.5 rounded-full text-white/40 hover:text-white/80 hover:bg-white/10 transition-all"
          >
            <X className="w-4 h-4" />
          </button>

          {/* 头部 */}
          <div className="relative px-8 pt-8 pb-5 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg shadow-amber-500/30 mb-3">
              <Crown className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-xl font-bold text-white mb-1.5">解锁 N1KO MUSIC 会员</h2>
            {featureName ? (
              <p className="text-sm text-white/60">
                <span className="text-amber-400 font-medium">「{featureName}」</span> 是会员专属功能
              </p>
            ) : (
              <p className="text-sm text-white/60">升级会员，享受完整音乐体验</p>
            )}
          </div>

          {/* 会员权益列表 */}
          <div className="px-5 pb-4 grid grid-cols-2 gap-2">
            {FEATURES.map(({ icon: Icon, label, desc }) => (
              <div
                key={label}
                className="flex items-start gap-2 p-2.5 rounded-xl bg-white/5 border border-white/8"
              >
                <div className="w-6 h-6 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon className="w-3 h-3 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-white/90 leading-tight">{label}</p>
                  <p className="text-[10px] text-white/40 mt-0.5 leading-tight">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* 激活码输入（直接展示，不再有 Tab 切换）*/}
          <div className="px-5 pt-2 pb-6">
            <CodePanel onSuccess={handleSuccess} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 锁定图标角标（叠加在置灰元素右上角）*/
export function PremiumBadge({ className }: { className?: string }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full',
      'bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30',
      'text-[10px] font-bold text-amber-400 uppercase tracking-wider',
      className
    )}>
      <Crown className="w-2.5 h-2.5" />
      PRO
    </span>
  )
}

/** Hook：用于需要会员权限的操作 */
export function usePremiumGuard() {
  const isPremium = useMemberStore(s => s.isPremium)
  const [showDialog, setShowDialog] = useState(false)
  const [featureName, setFeatureName] = useState<string | undefined>()

  const guard = (feature: string, callback: () => void) => {
    if (isPremium) {
      callback()
    } else {
      setFeatureName(feature)
      setShowDialog(true)
    }
  }

  return { guard, showDialog, setShowDialog, featureName, isPremium }
}

