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

/** 键帽：一小块墨色淡底，不画框 */
const KEYCAP = 'num grid min-w-[26px] place-items-center rounded-[7px] bg-ink/[0.07] px-1.5 py-0.5 font-sans text-[12.5px] font-medium leading-5 text-ink-2'

export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT()
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center p-6"
      onClick={onClose}
      role="presentation"
    >
      {/*
        遮罩与面板是兄弟，不是父子：给遮罩加 opacity 动画会让它成为「背景根」，
        里面那块玻璃的 backdrop-filter 就只看得到遮罩自己，模糊失效、底下的字透出来。
      */}
      <div className="absolute inset-0 bg-ink/25 animate-overlay-in motion-reduce:animate-none" aria-hidden="true" />
      <div
        role="dialog"
        aria-label={t('shortcuts.title')}
        className="glass relative grid max-h-full w-full max-w-[820px] grid-cols-1 gap-x-8 gap-y-6 overflow-y-auto rounded-xl p-6 animate-dialog-in motion-reduce:animate-none regular:grid-cols-3 regular:p-8"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink regular:col-span-3">
          {t('shortcuts.title')}
        </h2>
        {GROUPS.map(([group, rows]) => (
          <section key={group} className="min-w-0">
            <h3 className="pb-2.5 text-[13px] font-semibold text-ink-3">{t(group)}</h3>
            <ul className="flex flex-col gap-2">
              {rows.map(([label, keys]) => {
                /* 「空格」是译文，整体一枚键帽；其余是字面键位，按空格拆成一枚枚键帽 */
                const caps = keys.startsWith('shortcuts.') ? [t(keys)] : keys.split(' ')
                return (
                  <li key={label} className="flex items-center justify-between gap-3 text-[14px] leading-snug">
                    <span className="min-w-0 text-ink">{t(label)}</span>
                    <span className="flex flex-none items-center gap-1">
                      {caps.map((cap, i) => (
                        <kbd key={i} className={KEYCAP}>{cap}</kbd>
                      ))}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
