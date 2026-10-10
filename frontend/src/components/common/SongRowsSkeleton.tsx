/**
 * 曲目行骨架（阶段 7.1）：Search / TopListDetail / Recommendations 三页
 * 原先各有一份逐字复制，改一处另两处就漂——收敛成一份。
 * hair-soft 行闪烁，形状对齐 SongList 的行（序号/封面/标题/专辑/时长）。
 */
export function SongRowsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="border-t border-hair">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-3 py-3 border-b border-hair-soft">
          <span className="w-8 h-3 rounded-sm bg-skeleton animate-pulse" />
          <span className="w-10 h-10 rounded-sm bg-skeleton animate-pulse" />
          <span className="flex-1 h-4 rounded-sm bg-skeleton animate-pulse" />
          <span className="hidden lg:block flex-1 h-3.5 rounded-sm bg-skeleton animate-pulse" />
          <span className="w-12 h-3.5 rounded-sm bg-skeleton animate-pulse" />
        </div>
      ))}
    </div>
  )
}
