/**
 * 键盘快捷键表：按住 ⌘ 约 0.65 秒浮现，松开就收（iPadOS 的「按住 ⌘ 看快捷键」）；
 * ⌘/ 可以常驻打开，Esc 或点空白处关闭。接妙控键盘的 iPad、桌面版都适用。
 */

import { useT } from '@/i18n'

const GROUPS: Array<[string, Array<[string, string]>]> = [
  ['shortcuts.groupPlayback', [
    ['shortcuts.playPause', 'shortcuts.space'],
    ['shortcuts.seek', '← →'],
    ['player.previous', '⌘ ←'],
    ['player.next', '⌘ →'],
    ['shortcuts.volume', '⌘ ↑ ↓'],
    ['player.mute', 'M'],
    ['player.shuffle', 'S'],
    ['shortcuts.repeat', 'R'],
    ['player.lyrics', '⌘ L'],
  ]],
  ['shortcuts.groupGo', [
    ['nav.home', '⌘ 1'],
    ['nav.recommendations', '⌘ 2'],
    ['nav.library', '⌘ 3'],
    ['nav.search', '⌘ F'],
    ['shortcuts.palette', '⌘ K'],
    ['action.back', '⌘ ['],
    ['action.forward', '⌘ ]'],
  ]],
  ['shortcuts.groupWindow', [
    ['shortcuts.sidebar', '⌃ ⌘ S'],
    ['shortcuts.panel', '⌥ ⌘ P'],
    ['player.carMode', '⇧ C'],
    ['shortcuts.sheet', '⌘ /'],
  ]],
]

export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT()
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-ink/25 p-6 animate-fade-in motion-reduce:animate-none"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label={t('shortcuts.title')}
        className="glass grid max-h-full w-full max-w-[720px] grid-cols-1 gap-x-8 gap-y-5 overflow-y-auto rounded-lg p-6 regular:grid-cols-3"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-[17px] font-semibold text-ink regular:col-span-3">{t('shortcuts.title')}</h2>
        {GROUPS.map(([group, rows]) => (
          <section key={group} className="min-w-0">
            <h3 className="pb-2 text-[13px] font-medium text-ink-faint">{t(group)}</h3>
            <ul className="flex flex-col gap-1.5">
              {rows.map(([label, keys]) => (
                <li key={label} className="flex items-baseline justify-between gap-3 text-[14px]">
                  <span className="truncate text-ink">{t(label)}</span>
                  <kbd className="num flex-none font-sans text-[13px] text-ink-soft">{keys.startsWith('shortcuts.') ? t(keys) : keys}</kbd>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
