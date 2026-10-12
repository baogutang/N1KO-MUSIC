/**
 * 阶段 6.5：README 音源能力表 ⊆ manifest 声明的 capabilities。
 * README 写了但 manifest 没声明的能力 = 界面到不了的死入口（1.1 的教训）。
 * 用 fs 读文件、\s* 匹配换行（Windows autocrlf 兼容）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../')

/** README 表格里一行的能力词条（中文/英文各一张表）→ manifest 能力名 */
const README_CAP_TO_MANIFEST: Record<string, string> = {
  搜索: 'search', Search: 'search',
  专辑: 'album', albums: 'album',
  歌手: 'artist', artists: 'artist',
  我的歌单: 'userPlaylists', 'your playlists': 'userPlaylists',
  收藏: 'favorites', favourites: 'favorites',
  每日推荐: 'recommendSongs', 'daily picks': 'recommendSongs',
  雷达推荐: 'recommendSongs', 'radar picks': 'recommendSongs',
  榜单: 'topLists', charts: 'topLists',
  歌词: 'lyrics', lyrics: 'lyrics',
  '加入 / 移出歌单': 'playlistWrite', 'add to / remove from playlists': 'playlistWrite',
}

function manifestCaps(id: string): string[] {
  const m = JSON.parse(readFileSync(resolve(repoRoot, 'plugins', id, 'manifest.json'), 'utf8'))
  return m.capabilities as string[]
}

function tableRows(md: string, sourceName: string): string[] {
  // 表行形如 | 网易云音乐 | ... | 能力列表 |；按 \s* 兼容换行
  return md.split(/\r?\n/).filter(l => l.includes(`| ${sourceName} |`))
}

describe('README 能力表 ⊆ manifest（6.5）', () => {
  it('网易云音乐（中文）表内每项能力都有 manifest 声明', () => {
    const md = readFileSync(resolve(repoRoot, 'README_CN.md'), 'utf8')
    const rows = tableRows(md, '网易云音乐')
    expect(rows.length).toBeGreaterThan(0)
    const caps = manifestCaps('netease')
    for (const [word, cap] of Object.entries(README_CAP_TO_MANIFEST)) {
      if (/[\u4e00-\u9fff]/.test(word) && rows.some(r => r.includes(word))) {
        expect(caps, `README 写了「${word}」（${cap}）但 netease manifest 未声明`).toContain(cap)
      }
    }
  })

  it('NetEase Cloud Music（英文）表同上', () => {
    const md = readFileSync(resolve(repoRoot, 'README.md'), 'utf8')
    const rows = tableRows(md, 'NetEase Cloud Music')
    expect(rows.length).toBeGreaterThan(0)
    const caps = manifestCaps('netease')
    for (const [word, cap] of Object.entries(README_CAP_TO_MANIFEST)) {
      if (!/[\u4e00-\u9fff]/.test(word) && rows.some(r => r.includes(word))) {
        expect(caps, `README 写了「${word}」（${cap}）但 netease manifest 未声明`).toContain(cap)
      }
    }
  })

  it('QQ 音乐两表不写 manifest 未声明的能力（如 favorites）', () => {
    const cn = readFileSync(resolve(repoRoot, 'README_CN.md'), 'utf8')
    const en = readFileSync(resolve(repoRoot, 'README.md'), 'utf8')
    const qqRows = [...tableRows(cn, 'QQ 音乐'), ...tableRows(en, 'QQ Music')]
    expect(qqRows.length).toBeGreaterThan(0)
    expect(manifestCaps('qqmusic')).not.toContain('favorites')
    // 表里若有「收藏/favourites」字样即失败（1.10 修正后已删）
    expect(qqRows.some(r => r.includes('收藏') || r.includes('favourites'))).toBe(false)
  })
})
