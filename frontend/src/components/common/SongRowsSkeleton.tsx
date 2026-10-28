/**
 * 曲目行骨架：Search / TopListDetail / Recommendations / Library / Favorites 共用一份。
 * 形状对齐 SongList 的行（序号 / 44px 封面 / 曲名 + 歌手 / 专辑 / 时长），
 * 块用 .skeleton（一道很淡的光从左扫到右）；不画分隔线，行与行之间只靠行距。
 * 曲名与歌手条的宽度按行轮换，免得一排一模一样的灰条像一堵墙。
 */

const TITLE_WIDTHS = ['w-[46%]', 'w-[62%]', 'w-[38%]', 'w-[54%]', 'w-[70%]']
const ARTIST_WIDTHS = ['w-[26%]', 'w-[34%]', 'w-[22%]', 'w-[30%]']

export function SongRowsSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-3 py-2">
          <span className="skeleton h-3 w-8 flex-none rounded-pill" />
          <span className="skeleton h-11 w-11 flex-none rounded-[9px]" />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className={`skeleton h-3.5 rounded-pill ${TITLE_WIDTHS[i % TITLE_WIDTHS.length]}`} />
            <span className={`skeleton h-3 rounded-pill ${ARTIST_WIDTHS[i % ARTIST_WIDTHS.length]}`} />
          </span>
          <span className="hidden flex-1 wide:block">
            <span className="skeleton block h-3 w-2/5 rounded-pill" />
          </span>
          <span className="skeleton h-3 w-10 flex-none rounded-pill" />
        </div>
      ))}
    </div>
  )
}
