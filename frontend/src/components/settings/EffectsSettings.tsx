/**
 * 音效的控件：总开关、预设、四个档位（低音 / 清晰度 / 声场 / 响度）和十段均衡器。
 *
 * 同一套控件用在两处：设置页的「音效」分区，和播放页「更多」里的对话框——
 * 音效是边听边调的东西，不该让人为了挪一下滑块离开正在播放的页面。
 * 所有改动实时作用在处理链上（audio/effects）；只有总开关要换一条播放路径，会从当前位置重新缓冲一下。
 */
import { useSyncExternalStore } from 'react'
import { useT } from '@/i18n'
import { useSettingsStore, type FxLevelKey } from '@/store/settingsStore'
import { usePlayerStore } from '@/store/playerStore'
import { computeReplayGainScalar, isAlbumContext } from '@/utils/replayGain'
import { Slider } from '@/components/ui/slider'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  FX_BANDS,
  FX_BAND_MAX_DB,
  FX_BAND_MIN_DB,
  FX_LEVEL_MAX,
  FX_PRESET_IDS,
  type FxPresetId,
} from '@/audio/effects/model'
import {
  fxPlatformSupported,
  getFxStatus,
  primeFx,
  subscribeFxStatus,
  type FxStatus,
} from '@/audio/effects/runtime'
import { Row, Section, Toggle, rowClass } from './primitives'

/** 预设 → 文案（写成字面量：词条检查要能在源码里找到每一个 key） */
const PRESET_LABEL: Record<FxPresetId, string> = {
  flat: 'fx.preset.flat',
  pop: 'fx.preset.pop',
  rock: 'fx.preset.rock',
  vocal: 'fx.preset.vocal',
  classical: 'fx.preset.classical',
  electronic: 'fx.preset.electronic',
  jazz: 'fx.preset.jazz',
  bass: 'fx.preset.bass',
  live: 'fx.preset.live',
}

/** 开着音效时，当前这首的实际情况 → 文案；off 不说话 */
const STATUS_LABEL: Record<Exclude<FxStatus, 'off'>, string> = {
  active: 'fx.status.active',
  'no-cors': 'fx.status.noCors',
  suspended: 'fx.status.suspended',
  unsupported: 'fx.status.unsupported',
}

const LEVELS: { key: FxLevelKey; name: string; desc: string }[] = [
  { key: 'fxBass', name: 'fx.bass.name', desc: 'fx.bass.desc' },
  { key: 'fxClarity', name: 'fx.clarity.name', desc: 'fx.clarity.desc' },
  { key: 'fxWidth', name: 'fx.width.name', desc: 'fx.width.desc' },
  { key: 'fxLoudness', name: 'fx.loudness.name', desc: 'fx.loudness.desc' },
]

/** 归一化压低到这个程度才提一句：再小的差别不至于左右对比时的判断 */
const RG_HINT_MIN_DB = 3

/**
 * 当前这首被音量归一化压低了多少分贝（没压就是 0）。
 * 和别的 App 对比音质时，响一点的那边几乎总会被听成「更好」——这件事得让人知道。
 */
function useReplayGainCutDb(): number {
  const currentSong = usePlayerStore(s => s.currentSong)
  const shuffle = usePlayerStore(s => s.shuffle)
  const queue = usePlayerStore(s => s.queue)
  const mode = useSettingsStore(s => s.replayGainMode)
  const preampDb = useSettingsStore(s => s.replayGainPreamp)
  const scalar = computeReplayGainScalar(currentSong, {
    mode,
    preampDb,
    albumContext: isAlbumContext({ shuffle, queue, currentSong }),
  })
  return scalar > 0 && scalar < 1 ? -20 * Math.log10(scalar) : 0
}

const bandLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz))
const signed = (db: number) => (db > 0 ? `+${db}` : String(db))

export function EffectsPanel() {
  const { t } = useT()
  const enabled = useSettingsStore(s => s.fxEnabled)
  const preset = useSettingsStore(s => s.fxPreset)
  const bands = useSettingsStore(s => s.fxBands)
  // 一项一个选择器：返回新对象的选择器每次都算「变了」
  const fxBass = useSettingsStore(s => s.fxBass)
  const fxClarity = useSettingsStore(s => s.fxClarity)
  const fxWidth = useSettingsStore(s => s.fxWidth)
  const fxLoudness = useSettingsStore(s => s.fxLoudness)
  const levels: Record<FxLevelKey, number> = { fxBass, fxClarity, fxWidth, fxLoudness }
  const setFxEnabled = useSettingsStore(s => s.setFxEnabled)
  const applyFxPreset = useSettingsStore(s => s.applyFxPreset)
  const setFxBand = useSettingsStore(s => s.setFxBand)
  const setFxLevel = useSettingsStore(s => s.setFxLevel)
  const status = useSyncExternalStore(subscribeFxStatus, getFxStatus, getFxStatus)
  const rgCutDb = useReplayGainCutDb()

  if (!fxPlatformSupported()) {
    return <Row name={t('fx.enable.name')} desc={t('fx.status.unsupported')} />
  }

  const toggle = (next: boolean) => {
    // 就在这次点击里把处理链建起来：浏览器只在用户手势内允许启动音频上下文
    if (next) primeFx()
    setFxEnabled(next)
  }

  return (
    <>
      <Row
        name={t('fx.enable.name')}
        desc={
          <>
            {t('fx.enable.desc')}
            {enabled && status !== 'off' && (
              <span className={cn('mt-1 block', status === 'active' ? 'text-leaf' : 'text-ink-2')}>
                {t(STATUS_LABEL[status])}
              </span>
            )}
            {enabled && rgCutDb >= RG_HINT_MIN_DB && (
              <span className="mt-1 block text-ink-2">
                {t('fx.replayGainHint', { db: rgCutDb.toFixed(1) })}
              </span>
            )}
          </>
        }
      >
        <Toggle checked={enabled} onChange={toggle} label={t('fx.enable.name')} />
      </Row>

      {enabled && (
        <>
          <div className={cn(rowClass, 'flex-col items-stretch gap-x-0')}>
            <p className="text-[15px] font-medium leading-snug text-ink">{t('fx.preset.name')}</p>
            <div role="radiogroup" aria-label={t('fx.preset.name')} className="mt-2 flex flex-wrap gap-2">
              {FX_PRESET_IDS.map(id => {
                const on = preset === id
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => applyFxPreset(id)}
                    className={cn(
                      'press-pop h-9 rounded-pill px-4 text-[14px] font-semibold transition-colors duration-2 motion-reduce:transition-none',
                      on ? 'bg-lime text-lime-ink' : 'bg-ink/[0.06] text-ink-2 hover:text-ink'
                    )}
                  >
                    {t(PRESET_LABEL[id])}
                  </button>
                )
              })}
              {preset === 'custom' && (
                <span className="grid h-9 place-items-center rounded-pill border border-edge/60 px-4 text-[14px] font-semibold text-ink-2">
                  {t('fx.preset.custom')}
                </span>
              )}
            </div>
          </div>

          {LEVELS.map(level => (
            <Row key={level.key} name={t(level.name)} desc={t(level.desc)}>
              <div className="flex w-60 max-w-full items-center gap-3">
                <Slider
                  value={[levels[level.key]]}
                  min={0}
                  max={FX_LEVEL_MAX}
                  step={1}
                  onValueChange={([v]) => setFxLevel(level.key, v)}
                  aria-label={t(level.name)}
                  aria-valuetext={t('fx.level.valueText', { value: levels[level.key] })}
                />
                <span className="num w-6 text-right text-[13px] text-ink-2">{levels[level.key]}</span>
              </div>
            </Row>
          ))}

          <div className={cn(rowClass, 'flex-col items-stretch gap-x-0')}>
            <p className="text-[15px] font-medium leading-snug text-ink">{t('fx.eq.name')}</p>
            <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{t('fx.eq.desc')}</p>
            <div className="mt-3 flex justify-between gap-1">
              {FX_BANDS.map((hz, i) => {
                const db = bands[i] ?? 0
                return (
                  <div key={hz} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                    <span className="num text-[11.5px] text-ink-2">{signed(db)}</span>
                    <Slider
                      orientation="vertical"
                      className="h-36"
                      value={[db]}
                      min={FX_BAND_MIN_DB}
                      max={FX_BAND_MAX_DB}
                      step={1}
                      onValueChange={([v]) => setFxBand(i, v)}
                      aria-label={t('fx.eq.band', { hz: bandLabel(hz) })}
                      aria-valuetext={t('fx.eq.valueText', { db: signed(db) })}
                    />
                    <span className="num text-[11.5px] text-ink-3">{bandLabel(hz)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </>
  )
}

/** 设置页里的「音效」分区 */
export function EffectsSection() {
  const { t } = useT()
  return (
    <Section title={t('settings.effects')}>
      <EffectsPanel />
    </Section>
  )
}

/** 播放页「更多」里打开的音效面板 */
export function EffectsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="regular:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('settings.effects')}</DialogTitle>
          <DialogDescription>{t('fx.dialogHint')}</DialogDescription>
        </DialogHeader>
        {/* 行自带 16px 内边距：往外让出同样的宽度，和对话框的标题左对齐 */}
        <div className="-mx-4 max-h-[62vh] overflow-y-auto">
          <EffectsPanel />
        </div>
      </DialogContent>
    </Dialog>
  )
}
