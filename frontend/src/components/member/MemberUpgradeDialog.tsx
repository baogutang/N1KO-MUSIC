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
import { CrownSimple, Lightning, MusicNote, Star, CheckCircle, WarningCircle, X, Key, CircleNotch } from '@phosphor-icons/react'
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
  { icon: MusicNote, label: '无损原码 / 超高音质', desc: '支持 FLAC、无损原码等高品质格式' },
  { icon: Lightning, label: '为你推荐', desc: '智能算法根据你的口味精选歌单' },
  { icon: Star, label: '我的收藏', desc: '跨设备同步收藏夹，随时随地听' },
  { icon: CheckCircle, label: '听歌统计', desc: '详细播放数据，了解你的音乐偏好' },
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
      <p className="text-xs text-muted-foreground text-center">输入激活码即可解锁会员</p>
      <div className="relative">
        <input
          type="text"
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && handleActivate()}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          className={cn(
            'w-full bg-surface border rounded-md px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/40',
            'outline-none focus:ring-2 transition-all duration-150 font-num tracking-widest text-center caret-primary',
            result?.type === 'error'
              ? 'border-destructive/50 focus:ring-destructive/30'
              : result?.type === 'success'
                ? 'border-primary/50 focus:ring-primary/30'
                : 'border-border focus:ring-primary/40 focus:border-primary/50'
          )}
          disabled={loading}
        />
      </div>

      {result && (
        <div className={cn(
          'flex items-center gap-2 text-sm rounded-md px-3 py-2 border',
          result.type === 'success'
            ? 'bg-primary/10 text-primary border-primary/20'
            : 'bg-destructive/10 text-destructive border-destructive/20'
        )}>
          {result.type === 'success'
            ? <CheckCircle weight="fill" className="w-4 h-4 flex-shrink-0" />
            : <WarningCircle weight="fill" className="w-4 h-4 flex-shrink-0" />}
          <span>{result.message}</span>
        </div>
      )}

      <Button
        className="w-full h-10 font-semibold"
        onClick={handleActivate}
        disabled={loading || !code.trim()}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <CircleNotch className="w-4 h-4 animate-spin" />
            验证中...
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <Key className="w-4 h-4" />
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
        <div className="relative rounded-lg overflow-hidden glass shadow-2xl">
          {/* 装饰光晕 */}
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-primary/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

          {/* 关闭按钮 */}
          <button
            onClick={() => onOpenChange(false)}
            className="absolute top-4 right-4 z-10 p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors duration-150 active:scale-[0.94]"
          >
            <X className="w-4 h-4" />
          </button>

          {/* 头部 */}
          <div className="relative px-8 pt-8 pb-5 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 shadow-lg shadow-amber-500/30 mb-3">
              <CrownSimple weight="fill" className="w-7 h-7 text-amber-950" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-1.5">解锁 N1KO MUSIC 会员</h2>
            {featureName ? (
              <p className="text-sm text-muted-foreground">
                <span className="text-primary font-medium">「{featureName}」</span> 是会员专属功能
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">升级会员，享受完整音乐体验</p>
            )}
          </div>

          {/* 会员权益列表 */}
          <div className="px-5 pb-4 grid grid-cols-2 gap-2">
            {FEATURES.map(({ icon: Icon, label, desc }) => (
              <div
                key={label}
                className="flex items-start gap-2 p-2.5 rounded-md bg-surface border border-border"
              >
                <div className="w-6 h-6 rounded-md bg-primary/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon weight="fill" className="w-3 h-3 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-foreground leading-tight">{label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{desc}</p>
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
      'bg-amber-500/15 border border-amber-500/30',
      'text-[10px] font-bold text-amber-400 uppercase tracking-wider',
      className
    )}>
      <CrownSimple weight="fill" className="w-2.5 h-2.5" />
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
