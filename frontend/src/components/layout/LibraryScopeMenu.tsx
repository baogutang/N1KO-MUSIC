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
import { useT } from '@/i18n'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function LibraryScopeMenu({ className }: { className?: string }) {
  const { t } = useT()
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
            // 侧栏底部空间窄：小号纸片胶囊；视觉 36px，用伪元素把命中区撑到 ≥44px
            "relative inline-flex h-9 max-w-full items-center gap-1.5 rounded-pill bg-sheet px-3 text-[12.5px] font-medium text-ink-soft shadow-press before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-['']",
            'transition-colors duration-150 hover:bg-paper-deep hover:text-ink motion-reduce:transition-none',
            className
          )}
          aria-label={t('library.scopeSwitch')}
        >
          <Books size={14} aria-hidden="true" className="flex-shrink-0" />
          <span className="truncate">{current?.name ?? t('library.scopeAll')}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48 glass">
        <DropdownMenuItem onClick={() => choose(undefined)} className="gap-2">
          <span className="w-3.5">{!scope && <Check size={12} className="text-primary" />}</span>
          {t('library.scopeAll')}
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
