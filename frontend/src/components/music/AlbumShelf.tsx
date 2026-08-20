/**
 * 服务端已经算好的专辑书架。
 *
 * getAlbumList2 有十种排序维度，此前只用了 newest 与 alphabeticalByName 两种，
 * frequent / recent / highest / starred 全都白放着。
 *
 * 渲染成编排式的文字榜单——章节线、中文标题配拉丁副题、编号行——
 * 而不是又一条封面滚动条：那会把这个界面变成流媒体商店。
 */

import { useNavigate } from 'react-router-dom'
import { useAlbumShelf, type AlbumShelfType } from '@/hooks/useServerQueries'
import { spaceCJK } from '@/utils/cjkTypography'

export function AlbumShelf({
  type,
  label,
  tag,
  limit = 6,
}: {
  type: AlbumShelfType
  label: string
  tag: string
  limit?: number
}) {
  const navigate = useNavigate()
  const { data, isLoading } = useAlbumShelf(type, limit)
  const albums = data?.items ?? []

  // 服务器没有这个维度的数据（或不支持）时整块不渲染，而不是留一个空标题
  if (isLoading || !albums.length) return null

  return (
    <section aria-labelledby={`shelf-${type}`}>
      <div className="section-head">
        <h2 id={`shelf-${type}`}>
          {label}<small>{tag}</small>
        </h2>
      </div>
      <ol className="border-t border-hair">
        {albums.map((album, index) => (
          <li key={album.id}>
            <button
              onClick={() => navigate(`/albums/${album.id}`)}
              className="group flex w-full items-baseline gap-4 border-b border-hair-soft px-2 py-3 text-left transition-[background,transform] duration-200 hover:translate-x-1 hover:bg-paper-deep"
            >
              <span className="font-num w-7 flex-none text-[11px] text-ink-faint">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-serif text-[15px] font-semibold group-hover:text-primary">
                  {spaceCJK(album.name)}
                </span>
                <span className="mt-0.5 block truncate text-[11.5px] text-ink-faint">
                  {spaceCJK(album.artist)}
                </span>
              </span>
              {album.playCount ? (
                <span className="font-num flex-none text-[11px] text-ink-faint">
                  {album.playCount} 次
                </span>
              ) : album.year ? (
                <span className="font-num flex-none text-[11px] text-ink-faint">{album.year}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
