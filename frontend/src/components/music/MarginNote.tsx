/**
 * 边注。
 *
 * 页面下方一块安静的第二中性面板，专门放你自己写的话：它在页面上占一格，
 * 说明它是这一页的一部分，而不是一个折叠起来的附属功能。
 *
 * 没写过的时候收成一行（标题、一句很淡的提示、「写一句」），和上面的曲目列表同宽；
 * 写过之后是一段正文加落款日期，正文限一个舒服的行长。
 */

import { useEffect, useRef, useState } from 'react'
import { PencilSimple, Check, X, Trash } from '@phosphor-icons/react'
import {
  deleteNote, readNote, saveNote, MAX_NOTE_LENGTH, type NoteTarget,
} from '@/services/notes'
import { Button } from '@/components/ui/button'
import { useServerStore } from '@/store/serverStore'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

const PLACEHOLDER_KEYS: Record<NoteTarget, string> = {
  song: 'song.notePlaceholder',
  album: 'album.notePlaceholder',
  artist: 'artist.notePlaceholder',
}

export function MarginNote({
  target,
  targetId,
  className,
}: {
  target: NoteTarget
  targetId: string
  className?: string
}) {
  const { t } = useT()
  const serverId = useServerStore(s => s.activeServerId)
  const [note, setNote] = useState(() =>
    serverId ? readNote(target, targetId, serverId) : null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 换歌 / 换专辑时重读：这个组件在同一路由下会被复用
  useEffect(() => {
    setNote(serverId ? readNote(target, targetId, serverId) : null)
    setEditing(false)
  }, [target, targetId, serverId])

  useEffect(() => {
    if (editing) textareaRef.current?.focus()
  }, [editing])

  if (!serverId) return null

  const placeholder = t(PLACEHOLDER_KEYS[target])

  const startEditing = () => {
    setDraft(note?.body ?? '')
    setEditing(true)
  }

  const commit = () => {
    const saved = saveNote(target, targetId, serverId, draft)
    // 清空后保存等同于删除：不留一条空边注在版面上
    if (!saved && note) {
      deleteNote(target, targetId, serverId)
      setNote(null)
    } else {
      setNote(saved)
    }
    setEditing(false)
  }

  const discard = () => {
    setDraft('')
    setEditing(false)
  }

  const remove = () => {
    deleteNote(target, targetId, serverId)
    setNote(null)
    setEditing(false)
  }

  // 还没写过：一行就够，不为一句提示撑起一整块面板
  if (!editing && !note) {
    return (
      <aside
        className={cn('flex items-center gap-4 rounded-lg bg-surface-2 py-1 pl-5 pr-1.5', className)}
        aria-label={t('section.marginalia')}
      >
        <p className="flex-none font-display text-[16px] font-semibold text-ink">{t('section.marginalia')}</p>
        <button
          type="button"
          onClick={startEditing}
          className="press-pop group/note flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-pill pl-1 pr-3 text-left"
        >
          <span className="min-w-0 flex-1 truncate text-[14px] text-ink-3 [@media(hover:hover)]:group-hover/note:text-ink-2">
            {spaceCJK(placeholder)}
          </span>
          <span className="inline-flex flex-none items-center gap-1.5 text-[13px] font-semibold text-ink-2 [@media(hover:hover)]:group-hover/note:text-leaf">
            <PencilSimple size={14} />
            {t('action.writeNote')}
          </span>
        </button>
      </aside>
    )
  }

  return (
    <aside
      className={cn('rounded-lg bg-surface-2 p-5', className)}
      aria-label={t('section.marginalia')}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="font-display text-[17px] font-semibold text-ink">
          {t('section.marginalia')}
        </p>
        {!editing && (
          <button
            type="button"
            onClick={startEditing}
            className="press-pop -mr-2 inline-flex min-h-11 items-center gap-1.5 rounded-pill px-3 text-[13px] font-semibold text-ink-2 hover:bg-ink/[0.05] hover:text-leaf"
          >
            <PencilSimple size={14} />
            {note ? t('action.edit') : t('action.writeNote')}
          </button>
        )}
      </div>

      {editing ? (
        <div>
          {/* 触屏上输入框字号必须 ≥16px，否则 iOS 聚焦时会放大整个页面（见 ui/input） */}
          <textarea
            ref={textareaRef}
            value={draft}
            maxLength={MAX_NOTE_LENGTH}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              // ⌘/Ctrl + Enter 提交，Esc 放弃——和所有写字的地方一致
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) commit()
              if (event.key === 'Escape') discard()
            }}
            rows={5}
            placeholder={placeholder}
            className="w-full resize-none rounded-md border border-edge/80 bg-surface px-4 py-3 text-base leading-[1.75] text-ink transition-colors duration-2 placeholder:text-ink-3 hover:border-edge regular:text-[15px]"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={commit}>
              <Check size={16} />
              {t('action.save')}
            </Button>
            <Button variant="ghost" onClick={discard}>
              <X size={16} />
              {t('action.discard')}
            </Button>
            <span className="num ml-auto text-[12px] text-ink-3">
              {draft.length} / {MAX_NOTE_LENGTH}
            </span>
            {note && (
              <Button variant="ghost" onClick={remove} className="hover:text-danger">
                <Trash size={16} />
                {t('action.delete')}
              </Button>
            )}
          </div>
        </div>
      ) : note ? (
        <button
          type="button"
          onClick={startEditing}
          className="-mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-1.5 text-left transition-colors [@media(hover:hover)]:hover:bg-ink/[0.05]"
        >
          <p className="max-w-[38em] whitespace-pre-wrap text-[15px] leading-[1.75] text-ink">
            {spaceCJK(note.body)}
          </p>
          <p className="num mt-2 text-[12px] text-ink-3">
            {formatDate(note.updatedAt)}
          </p>
        </button>
      ) : null}
    </aside>
  )
}
