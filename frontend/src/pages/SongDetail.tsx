/**
 * 歌曲详情页
 * - 通过 router state 传入 Song 对象（navigate('/songs/detail', { state: { song } })）
 * - 分「基础」「扩展」两块，布局参考 macOS 音乐信息面板
 */

import { useLocation, useNavigate } from 'react-router-dom'
import {
  ChevronLeft,
  Music2, Disc3, User, Users, AlignLeft,
  Calendar, Hash, Layers, FileAudio,
  HardDrive, Gauge, Clock, PlayCircle, Timer, FolderOpen,
  ArrowRight
} from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { formatDuration, formatFileSize } from '@/utils/formatters'
import { usePlayerStore } from '@/store/playerStore'
import type { Song } from '@/api/types'

interface SectionProps {
  title: string
  children: React.ReactNode
}

function Section({ title, children }: SectionProps) {
  return (
    <div className="mb-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium px-4 mb-1.5">
        {title}
      </p>
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden divide-y divide-border/50">
        {children}
      </div>
    </div>
  )
}

interface RowProps {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  onClick?: () => void
  /** 是否展示跳转箭头 */
  linkable?: boolean
}

function Row({ icon, label, value, onClick, linkable }: RowProps) {
  const inner = (
    <>
      <div className="flex items-center gap-3 text-muted-foreground flex-shrink-0 w-36">
        <span className="flex-shrink-0">{icon}</span>
        <span className="text-sm text-foreground/80">{label}</span>
      </div>
      <div className="flex-1 text-right flex items-center justify-end gap-1 min-w-0">
        <span className="text-sm text-foreground/70 truncate text-right">{value}</span>
        {linkable && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
      </div>
    </>
  )

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-accent/50 transition-colors text-left"
      >
        {inner}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      {inner}
    </div>
  )
}

export default function SongDetailPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const song = location.state?.song as Song | undefined
  const setFullscreen = usePlayerStore(s => s.setFullscreen)

  if (!song) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 text-muted-foreground">
        <Music2 className="w-12 h-12 opacity-30" />
        <p className="text-sm">未找到歌曲信息</p>
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-primary hover:underline"
        >
          返回
        </button>
      </div>
    )
  }

  const contentTypeLabel = song.contentType
    ? song.contentType.split('/')[1]?.toLowerCase() ?? song.contentType
    : undefined

  return (
    <div className="flex flex-col h-full">
      {/* 顶部栏 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60 flex-shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-full hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-base font-semibold">歌曲详情</h1>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 max-w-2xl mx-auto">

          {/* 基础信息 */}
          <Section title="基础">
            <Row
              icon={<Music2 className="w-4 h-4" />}
              label="标题"
              value={song.title}
            />
            {song.album && (
              <Row
                icon={<Disc3 className="w-4 h-4" />}
                label="专辑"
                value={song.album}
                onClick={song.albumId ? () => navigate(`/albums/${song.albumId}`) : undefined}
                linkable={!!song.albumId}
              />
            )}
            {song.artist && (
              <Row
                icon={<User className="w-4 h-4" />}
                label="专辑艺术家"
                value={song.artist}
                onClick={song.artistId ? () => navigate(`/artists/${song.artistId}`) : undefined}
                linkable={!!song.artistId}
              />
            )}
            {song.artist && (
              <Row
                icon={<Users className="w-4 h-4" />}
                label="歌手"
                value={song.artist}
                onClick={song.artistId ? () => navigate(`/artists/${song.artistId}`) : undefined}
                linkable={!!song.artistId}
              />
            )}
            <Row
              icon={<AlignLeft className="w-4 h-4" />}
              label="歌词"
              value="查看歌词"
              onClick={() => {
                // 打开全屏播放器（全屏播放器自带歌词视图）
                // 仅当当前正在播放的歌曲与详情页是同一首时才有意义
                navigate(-1)
                setTimeout(() => setFullscreen(true), 50)
              }}
              linkable
            />
            {song.year != null && (
              <Row
                icon={<Calendar className="w-4 h-4" />}
                label="年代"
                value={song.year || 0}
              />
            )}
            {song.track != null && (
              <Row
                icon={<Hash className="w-4 h-4" />}
                label="音轨号"
                value={song.track || 0}
              />
            )}
          </Section>

          {/* 扩展信息 */}
          <Section title="扩展">
            {song.path && (
              <Row
                icon={<FolderOpen className="w-4 h-4" />}
                label="文件路径"
                value={song.path}
              />
            )}
            {song.size != null && song.size > 0 && (
              <Row
                icon={<HardDrive className="w-4 h-4" />}
                label="文件大小"
                value={formatFileSize(song.size)}
              />
            )}
            {contentTypeLabel && (
              <Row
                icon={<FileAudio className="w-4 h-4" />}
                label="文件格式"
                value={contentTypeLabel}
              />
            )}
            {song.duration > 0 && (
              <Row
                icon={<Clock className="w-4 h-4" />}
                label="时长"
                value={formatDuration(song.duration)}
              />
            )}
            {song.bitRate != null && song.bitRate > 0 && (
              <Row
                icon={<Gauge className="w-4 h-4" />}
                label="比特率"
                value={`${song.bitRate} kbps`}
              />
            )}
            {song.playCount != null && (
              <Row
                icon={<PlayCircle className="w-4 h-4" />}
                label="播放次数"
                value={song.playCount}
              />
            )}
            {song.genre && (
              <Row
                icon={<Layers className="w-4 h-4" />}
                label="流派"
                value={song.genre}
              />
            )}
            {song.userRating != null && song.userRating > 0 && (
              <Row
                icon={<Timer className="w-4 h-4" />}
                label="评分"
                value={`${song.userRating} / 5`}
              />
            )}
          </Section>

        </div>
      </ScrollArea>
    </div>
  )
}
