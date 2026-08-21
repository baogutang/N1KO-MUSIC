/**
 * 音乐库切换。
 *
 * 只在服务器确实暴露了多于一个库时出现——只有一个库的时候这个控件毫无意义，
 * 摆在那里只会让人以为自己漏配了什么。
 */

import { Books, Check } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import { useServerStore } from '@/store/serverStore'
import { useLibraryScopeStore } from '@/store/libraryScopeStore'
import { useServerCapabilities } from '@/hooks/useServerCapabilities'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function LibraryScopeMenu({ className }: { className?: string }) {
  const activeServerId = useServerStore(s => s.activeServerId)
  const scope = useLibraryScopeStore(s => (activeServerId ? s.scopes[activeServerId] : undefined))
  const setScope = useLibraryScopeStore(s => s.setScope)
  const { musicFolders, folders } = useServerCapabilities()
  const queryClient = useQueryClient()

  if (!musicFolders || !activeServerId) return null

  const current = folders.find(f => f.id === scope)

  function choose(folderId: string | undefined) {
    if (!activeServerId) return
    setScope(activeServerId, folderId)
    // 库范围参与缓存键，切换后旧键不会再被读到；清掉以免长期占内存
    queryClient.removeQueries({ predicate: q => Array.isArray(q.queryKey) && typeof q.queryKey[0] === 'string' })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'inline-flex items-center gap-1.5 text-[11px] tracking-[0.12em] text-ink-faint',
            'transition-colors duration-200 hover:text-ink',
            className
          )}
          aria-label="切换音乐库"
        >
          <Books size={12} aria-hidden="true" />
          {current?.name ?? '全部音乐库'}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48 glass">
        <DropdownMenuItem onClick={() => choose(undefined)} className="gap-2">
          <span className="w-3.5">{!scope && <Check size={12} className="text-primary" />}</span>
          全部音乐库
        </DropdownMenuItem>
        {folders.map(folder => (
          <DropdownMenuItem key={folder.id} onClick={() => choose(folder.id)} className="gap-2">
            <span className="w-3.5">
              {scope === folder.id && <Check size={12} className="text-primary" />}
            </span>
            {folder.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
