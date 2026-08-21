/**
 * 边注。
 *
 * 版面右侧那一小块窄栏，专门放你自己写的话。杂志里的边注就是这个位置：
 * 比正文小一号、不抢，但确实在页面上占一格，说明它是这一页的一部分，
 * 而不是一个折叠起来的附属功能。
 *
 * 没写过的时候只是一行很淡的提示，不做空盒子；写过之后是一段衬线文字加落款日期。
 */

import { useEffect, useRef, useState } from 'react'
import { PencilSimple, Check, X, Trash } from '@phosphor-icons/react'
import {
  deleteNote, readNote, saveNote, MAX_NOTE_LENGTH, type NoteTarget,
} from '@/services/notes'
import { useServerStore } from '@/store/serverStore'
import { spaceCJK } from '@/utils/cjkTypography'
import { cn } from '@/lib/utils'

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

const PLACEHOLDERS: Record<NoteTarget, string> = {
  song: '写点什么：第一次是在哪听到的，或者这段间奏为什么好。',
  album: '写点什么：为什么留着这张。',
  artist: '写点什么：从哪一首开始的。',
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
      className={cn('border-t border-hair pt-4', className)}
      aria-label="边注"
    >
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <p className="text-[10.5px] uppercase tracking-[0.24em] text-primary">
          边注 · MARGINALIA
        </p>
        {!editing && (
          <button
            onClick={startEditing}
            className="flex items-center gap-1.5 text-[11px] text-ink-faint transition-colors hover:text-primary"
          >
            <PencilSimple size={11} />
            {note ? '修改' : '写一条'}
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
            placeholder={PLACEHOLDERS[target]}
            className="w-full resize-none border-b border-hair bg-transparent pb-2 font-serif text-[14px] leading-[1.85] text-ink placeholder:text-ink-faint focus:border-primary focus:outline-none"
          />
          <div className="mt-2.5 flex items-center gap-4">
            <button
              onClick={commit}
              className="flex items-center gap-1.5 text-[12px] font-semibold transition-colors hover:text-primary"
            >
              <Check size={12} />
              存下
            </button>
            <button
              onClick={discard}
              className="flex items-center gap-1.5 text-[12px] text-ink-faint transition-colors hover:text-ink"
            >
              <X size={12} />
              放弃
            </button>
            {note && (
              <button
                onClick={remove}
                className="ml-auto flex items-center gap-1.5 text-[12px] text-ink-faint transition-colors hover:text-destructive"
              >
                <Trash size={12} />
                删掉
              </button>
            )}
            <span className="font-num ml-auto text-[10.5px] text-ink-faint">
              {draft.length} / {MAX_NOTE_LENGTH}
            </span>
          </div>
        </div>
      ) : note ? (
        <button onClick={startEditing} className="block w-full text-left">
          <p className="whitespace-pre-wrap font-serif text-[14px] leading-[1.9] text-ink">
            {spaceCJK(note.body)}
          </p>
          <p className="font-num mt-2.5 text-[10.5px] text-ink-faint">
            {formatDate(note.updatedAt)}
          </p>
        </button>
      ) : (
        <button
          onClick={startEditing}
          className="block w-full text-left font-serif text-[13px] leading-[1.85] text-ink-faint transition-colors hover:text-ink-soft"
        >
          {spaceCJK(PLACEHOLDERS[target])}
        </button>
      )}
    </aside>
  )
}
