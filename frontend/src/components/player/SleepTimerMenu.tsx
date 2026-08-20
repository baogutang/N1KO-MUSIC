/**
 * 睡眠定时。
 *
 * 倒计时到点前最后几秒渐弱再暂停，而不是在延音上硬切。
 * 定时状态刻意不持久化——重启后残留的过期截止会让 App 一打开就暂停。
 */

import { useEffect, useState } from 'react'
import { Moon } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { usePlayerStore } from '@/store/playerStore'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const PRESETS = [15, 30, 45, 60, 90]

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function SleepTimerMenu({ className }: { className?: string }) {
  const sleepTimerAt = usePlayerStore(s => s.sleepTimerAt)
  const sleepTimerMode = usePlayerStore(s => s.sleepTimerMode)
  const setSleepTimer = usePlayerStore(s => s.setSleepTimer)
  const [now, setNow] = useState(() => Date.now())

  // 只在定时开启时走秒级刷新，避免常驻一个空转的 interval
  useEffect(() => {
    if (sleepTimerAt === null || sleepTimerMode === 'endOfTrack') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [sleepTimerAt, sleepTimerMode])

  const active = sleepTimerAt !== null
  const remaining = active && sleepTimerMode === 'duration' ? sleepTimerAt - now : 0

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(className, active && 'text-primary')}
          aria-label="睡眠定时"
          aria-pressed={active}
        >
          {active && sleepTimerMode === 'duration' ? (
            <span className="font-num text-[10.5px] tabular-nums">{formatRemaining(remaining)}</span>
          ) : (
            <Moon size={16} weight={active ? 'fill' : 'regular'} />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 glass">
        <div className="px-3 py-2 border-b border-hair-soft">
          <p className="font-serif text-sm font-semibold">睡眠定时</p>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            {active
              ? sleepTimerMode === 'endOfTrack'
                ? '这首放完后停止'
                : `${formatRemaining(remaining)} 后停止`
              : '到点前会先渐弱'}
          </p>
        </div>
        {PRESETS.map(minutes => (
          <DropdownMenuItem key={minutes} onClick={() => setSleepTimer(minutes)}>
            <span className="font-num mr-2 text-ink-faint">{minutes}</span>
            分钟后
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onClick={() => setSleepTimer(null, 'endOfTrack')}>
          这首放完
        </DropdownMenuItem>
        {active && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setSleepTimer(null)} className="text-primary">
              取消定时
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
