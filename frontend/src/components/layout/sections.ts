/**
 * 路径到栏目名的文案 key。找不到就不写栏目，不去猜。
 *
 * 工具栏标题（滚过大标题后浮现的那一行）与文档标题都用它；
 * 主布局下每加一条内容路由，这里要跟一条（sections.test.ts 兜底）。
 */
const SECTION_KEYS: Array<[RegExp, string]> = [
  [/^\/$/, 'nav.home'],
  [/^\/library/, 'nav.library'],
  [/^\/albums\/[^/]+$/, 'section.albums'],
  [/^\/albums$/, 'section.albums'],
  [/^\/artists\/[^/]+$/, 'nav.artists'],
  [/^\/artists$/, 'nav.artists'],
  [/^\/playlists/, 'nav.playlists'],
  [/^\/recommendations/, 'nav.recommendations'],
  [/^\/favorites/, 'nav.favorites'],
  [/^\/history/, 'nav.history'],
  [/^\/stats/, 'nav.stats'],
  [/^\/issue/, 'nav.issue'],
  [/^\/search/, 'section.search'],
  [/^\/toplists/, 'sources.topLists'],
  [/^\/songs\//, 'nav.songDetail'],
  [/^\/settings/, 'nav.settings'],
]

export function sectionKeyFor(pathname: string): string | null {
  return SECTION_KEYS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null
}
