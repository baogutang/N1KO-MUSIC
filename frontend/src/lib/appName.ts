/** 界面上的软件名。留空就用这个。 */
export const DEFAULT_APP_NAME = 'X-MUSIC'
/** 开屏要一个字一个字升起，太长会超出屏幕，也来不及在收场前播完。 */
export const APP_NAME_MAX_GRAPHEMES = 24

export function graphemes(value: string): string[] {
  const Segmenter = (Intl as typeof Intl & {
    Segmenter?: new (locales: undefined, options: { granularity: 'grapheme' }) => {
      segment(input: string): Iterable<{ segment: string }>
    }
  }).Segmenter
  if (Segmenter) {
    return [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map(part => part.segment)
  }
  return Array.from(value)
}

/** 输入框里保留用户正在打的空格，只限制长度。 */
export function clampAppName(raw: string): string {
  return graphemes(raw).slice(0, APP_NAME_MAX_GRAPHEMES).join('')
}

/** 真正显示出来的名字。空白一律回到默认名。 */
export function resolveAppName(raw: string | undefined | null): string {
  const name = graphemes((raw ?? '').trim()).slice(0, APP_NAME_MAX_GRAPHEMES).join('')
  return name || DEFAULT_APP_NAME
}

/** 字标最后一个字落定之后再收场，短名字仍维持原来的大约两秒。 */
export function splashHoldMs(glyphCount: number, reduced: boolean): number {
  if (reduced) return 320
  const lastLetterDone = 740 + Math.max(0, glyphCount - 1) * 60 + 620
  return Math.max(2050, lastLetterDone + 280)
}
