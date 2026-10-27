/**
 * 边注。
 *
 * 页面下方一张纸片卡，专门放你自己写的话：它在页面上占一格，
 * 说明它是这一页的一部分，而不是一个折叠起来的附属功能。
 *
 * 没写过的时候只是一行很淡的提示；写过之后是一段正文加落款日期。
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

  return (
    <aside
      className={cn('sheet p-5', className)}
      aria-label={t('section.marginalia')}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="font-display text-[17px] font-semibold">
          {t('section.marginalia')}
        </p>
        {!editing && (
          <button
            onClick={startEditing}
            className="-mr-2 inline-flex min-h-11 items-center gap-1.5 rounded-pill px-3 text-[13px] font-medium text-ink-soft transition-colors hover:bg-paper-deep hover:text-primary"
          >
            <PencilSimple size={14} />
            {note ? t('action.edit') : t('action.writeNote')}
          </button>
        )}
      </div>

      {editing ? (
        <div>
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
            className="w-full resize-none rounded-md bg-paper-deep px-4 py-3 text-[14px] leading-[1.85] text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={commit}>
              <Check size={14} />
              {t('action.save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={discard}>
              <X size={14} />
              {t('action.discard')}
            </Button>
            <span className="num ml-auto text-xs text-ink-faint">
              {draft.length} / {MAX_NOTE_LENGTH}
            </span>
            {note && (
              <Button size="sm" variant="ghost" onClick={remove} className="hover:text-destructive">
                <Trash size={14} />
                {t('action.delete')}
              </Button>
            )}
          </div>
        </div>
      ) : note ? (
        <button
          onClick={startEditing}
          className="-mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-1.5 text-left transition-colors [@media(hover:hover)]:hover:bg-paper-deep"
        >
          <p className="whitespace-pre-wrap text-[14.5px] leading-[1.85] text-ink">
            {spaceCJK(note.body)}
          </p>
          <p className="num mt-2 text-xs text-ink-faint">
            {formatDate(note.updatedAt)}
          </p>
        </button>
      ) : (
        <button
          onClick={startEditing}
          className="-mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-1.5 text-left text-[14px] leading-[1.85] text-ink-faint transition-colors [@media(hover:hover)]:hover:bg-paper-deep [@media(hover:hover)]:hover:text-ink-soft"
        >
          {spaceCJK(placeholder)}
        </button>
      )}
    </aside>
  )
}
