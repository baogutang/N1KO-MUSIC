/**
 * 曲目行骨架：Search / TopListDetail / Recommendations / Library 共用一份。
 * bg-skeleton 的圆角条闪烁，形状对齐 SongList 的行（序号 / 封面 / 标题 / 专辑 / 时长）；
 * 不画分隔线，行与行之间只靠行距。
 */
export function SongRowsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-0.5" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-3 py-2.5">
          <span className="h-3 w-8 rounded-sm bg-skeleton animate-pulse" />
          <span className="h-11 w-11 rounded-sm bg-skeleton animate-pulse" />
          <span className="h-4 flex-1 rounded-sm bg-skeleton animate-pulse" />
          <span className="hidden h-3.5 flex-1 rounded-sm bg-skeleton animate-pulse wide:block" />
          <span className="h-3.5 w-12 rounded-sm bg-skeleton animate-pulse" />
        </div>
      ))}
    </div>
  )
}
