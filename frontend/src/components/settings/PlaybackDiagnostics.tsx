/**
 * 设置 · 关于 · 播放诊断：最近几次「播着播着停了」各是谁停的（lib/playbackTrail）。
 *
 * 给的是能拿去判断的东西：原因、发生的时刻、当时往后还缓冲着多少秒、页面在不在前台。
 * 「复制」导出一段纯文本，方便贴给开发者——里面不带歌名和服务器地址，只有状态数字。
 */
import { useState, useSyncExternalStore } from 'react'
import { useT } from '@/i18n'
import { nativeOS } from '@/lib/platform'
import { toast } from '@/components/ui/use-toast'
import { getPauseRecords, subscribePauseRecords, type PauseRecord } from '@/lib/playbackTrail'
import { Row } from './primitives'
import pkg from '../../../package.json'

const SHOWN = 6

/** 原因 → 文案（写成字面量：词条检查要能在源码里找到每一个 key） */
const REASON_LABEL: Record<PauseRecord['reason'], string> = {
  ui: 'diag.reason.ui',
  element: 'diag.reason.element',
  remote: 'diag.reason.remote',
  'media-session': 'diag.reason.mediaSession',
  device: 'diag.reason.device',
  offline: 'diag.reason.offline',
  error: 'diag.reason.error',
  sleep: 'diag.reason.sleep',
  'queue-end': 'diag.reason.queueEnd',
  unknown: 'diag.reason.unknown',
}

function clock(at: number) {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 复制出去的报告：一行一条，只有原因和数字 */
function reportText(records: PauseRecord[]) {
  const head = `N1KO MUSIC v${pkg.version} · ${nativeOS} · ${typeof navigator !== 'undefined' ? navigator.userAgent : ''}`
  const lines = records.map(r => {
    const c = r.ctx
    return [
      new Date(r.at).toISOString(),
      r.reason,
      r.detail ? `(${r.detail})` : '',
      `t=${c.currentTime}/${c.duration}`,
      `ahead=${c.bufferedAhead}s`,
      `paused=${c.elementPaused}`,
      `ready=${c.readyState}`,
      `net=${c.networkState}`,
      `err=${c.errorCode}`,
      `vis=${c.visibility}`,
      `online=${c.online}`,
    ].filter(Boolean).join(' ')
  })
  return [head, ...lines].join('\n')
}

export function PlaybackDiagnostics() {
  const { t } = useT()
  const records = useSyncExternalStore(subscribePauseRecords, getPauseRecords, getPauseRecords)
  const [open, setOpen] = useState(false)
  const latest = records[records.length - 1]

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reportText(records))
      toast({ title: t('diag.copied') })
    } catch {
      toast({ title: t('diag.copyFailed'), variant: 'destructive' })
    }
  }

  return (
    <>
      <Row
        name={t('diag.title')}
        desc={latest
          ? t('diag.latest', { time: clock(latest.at), reason: t(REASON_LABEL[latest.reason]), ahead: Math.round(latest.ctx.bufferedAhead) })
          : t('diag.none')}
      >
        <div className="flex items-center gap-2">
          {records.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen(v => !v)}
              aria-expanded={open}
              className="press-pop h-11 rounded-pill px-3.5 text-[14px] font-semibold text-leaf hover:bg-fill [@media(hover:hover)]:h-9"
            >
              {open ? t('diag.hide') : t('diag.show')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void copy()}
            disabled={!records.length}
            className="press-pop h-11 rounded-pill bg-fill px-3.5 text-[14px] font-semibold text-ink hover:bg-fill-2 disabled:opacity-40 [@media(hover:hover)]:h-9"
          >
            {t('diag.copy')}
          </button>
        </div>
      </Row>
      {open && (
        <ol className="space-y-2 px-4 py-3 hairline-b">
          {records.slice(-SHOWN).reverse().map(r => (
            <li key={r.at} className="text-[13px] leading-snug">
              <span className="num text-ink-3">{clock(r.at)}</span>
              <span className="ml-2 font-medium text-ink">{t(REASON_LABEL[r.reason])}</span>
              {r.songTitle && <span className="ml-2 text-ink-2">{r.songTitle}</span>}
              <span className="mt-0.5 flex flex-wrap gap-x-3 text-ink-3">
                <span>
                  {t('diag.context', {
                    ahead: Math.round(r.ctx.bufferedAhead),
                    where: t(r.ctx.visibility === 'visible' ? 'diag.visible' : 'diag.hidden'),
                  })}
                </span>
                {r.detail && <span>{r.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}
