/**
 * `n1ko://` 深链接。
 *
 * 一个装在本机的播放器应该能被本机的其它东西调起：Alfred / Raycast 的一条
 * 脚本、Shortcuts 里的一步、笔记里的一行链接、朋友发来的一首歌。
 *
 * 语法刻意做得能手写：
 *   n1ko://song/<id>        打开并播放这首歌
 *   n1ko://album/<id>       打开专辑（?play=1 直接连播）
 *   n1ko://artist/<id>      打开歌手
 *   n1ko://playlist/<id>    打开歌单（?play=1 直接连播）
 *   n1ko://search?q=<词>    带着关键词进搜索
 *   n1ko://play             继续播放
 *   n1ko://pause            暂停
 *   n1ko://next / prev      切歌
 *   n1ko://shuffle          全库随机
 *
 * 传进来的都是外部输入，一律当不可信处理：只认白名单里的动作，
 * 其余一概忽略并留一条日志——不去猜用户「大概想干什么」。
 */

import { getAdapter, hasAdapter } from '@/api'
import { usePlayerStore } from '@/store/playerStore'
import { playAllInOrder, playListFrom, shuffleWholeLibrary } from '@/utils/playActions'

export const DEEP_LINK_SCHEME = 'n1ko'

export interface DeepLinkAction {
  /** 需要跳转的应用内路径，没有则表示纯控制指令 */
  route?: string
  /** 解析出来的指令，交给执行层去跑 */
  command?:
    | { kind: 'play' }
    | { kind: 'pause' }
    | { kind: 'next' }
    | { kind: 'prev' }
    | { kind: 'shuffleLibrary' }
    | { kind: 'playSong'; id: string }
    | { kind: 'playAlbum'; id: string }
    | { kind: 'playPlaylist'; id: string }
}

/** id 只允许服务端会产出的字符集，挡住路径穿越和注入 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * 解析一条深链接。
 *
 * 纯函数、不碰任何全局状态，这样解析规则可以被单独测。
 * 认不出来返回 null，调用方据此忽略。
 */
export function parseDeepLink(raw: string): DeepLinkAction | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== `${DEEP_LINK_SCHEME}:`) return null

  /**
   * 先挡掉带 `..` 的链接。
   *
   * URL 解析器会**先**把 `..` 归一化掉：`n1ko://song/abc/../../settings`
   * 到手时 pathname 已经是 `/settings`，于是「取第一段」拿到的是 settings，
   * 播的歌和链接字面写的完全不是一回事。虽然 SAFE_ID 和固定的路由模板保证了
   * 跳不出 /songs/ 这个命名空间，但静悄悄换一个 id 本身就不该发生——
   * 这种链接一律判为畸形。
   */
  if (/(^|[/\\])\.\.([/\\]|$)/.test(raw)) return null

  // n1ko://song/abc 里 host 是 "song"，pathname 是 "/abc"
  const action = url.hostname.toLowerCase()
  const segments = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean)
  // 多段路径没有任何合法含义，同样判为畸形
  if (segments.length > 1) return null
  /**
   * decodeURIComponent 遇到畸形的百分号转义（`%`、`%zz`）会抛 URIError，
   * 而这个函数对外的约定是「认不出来返回 null，绝不抛错」——
   * 调用方（useDeepLinks / OpenLink 页）都没有 try/catch，抛出去就是白屏。
   */
  let id: string
  try {
    id = decodeURIComponent(segments[0] ?? '')
  } catch {
    return null
  }
  const wantsPlay = url.searchParams.get('play') === '1'

  switch (action) {
    case 'play':
      return { command: { kind: 'play' } }
    case 'pause':
      return { command: { kind: 'pause' } }
    case 'next':
      return { command: { kind: 'next' } }
    case 'prev':
    case 'previous':
      return { command: { kind: 'prev' } }
    case 'shuffle':
      return { command: { kind: 'shuffleLibrary' } }

    case 'song':
      if (!SAFE_ID.test(id)) return null
      return { route: `/songs/${id}`, command: { kind: 'playSong', id } }

    case 'album':
      if (!SAFE_ID.test(id)) return null
      return {
        route: `/albums/${id}`,
        ...(wantsPlay ? { command: { kind: 'playAlbum' as const, id } } : {}),
      }

    case 'artist':
      if (!SAFE_ID.test(id)) return null
      return { route: `/artists/${id}` }

    case 'playlist':
      if (!SAFE_ID.test(id)) return null
      return {
        route: `/playlists/${id}`,
        ...(wantsPlay ? { command: { kind: 'playPlaylist' as const, id } } : {}),
      }

    case 'search': {
      const query = url.searchParams.get('q')?.trim()
      if (!query) return { route: '/search' }
      return { route: `/search?q=${encodeURIComponent(query)}` }
    }

    default:
      return null
  }
}

/** 执行解析出来的指令。需要联网的部分失败就静默——深链接不该弹一堆错。 */
export async function runDeepLinkCommand(command: NonNullable<DeepLinkAction['command']>): Promise<void> {
  const player = usePlayerStore.getState()
  switch (command.kind) {
    case 'play':
      player.resume()
      return
    case 'pause':
      player.pause()
      return
    case 'next':
      player.next()
      return
    case 'prev':
      player.prev()
      return
    case 'shuffleLibrary':
      await shuffleWholeLibrary()
      return
    case 'playSong': {
      // 深链接只带裸 id（不加 server 前缀，见 deepLink id 白名单），
      // 解析始终落主库；跨源深链接若要做，得先改链接格式本身
      if (!hasAdapter()) return
      const song = await getAdapter().getSong(command.id).catch(() => null)
      if (song) playListFrom([song], 0)
      return
    }
    case 'playAlbum': {
      if (!hasAdapter()) return
      const album = await getAdapter().getAlbumDetail(command.id).catch(() => null)
      if (album?.songs.length) playAllInOrder(album.songs)
      return
    }
    case 'playPlaylist': {
      if (!hasAdapter()) return
      const playlist = await getAdapter().getPlaylistDetail(command.id).catch(() => null)
      if (playlist?.songs.length) playAllInOrder(playlist.songs)
      return
    }
  }
}
