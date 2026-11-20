/**
 * 音效的数据模型：用户能调的几个量、内置预设，以及它们换算成处理链参数的规则。
 *
 * 这里全是纯函数，不碰 Web Audio——处理链（graph.ts）只管照着 deriveFx 的结果接线、设参数，
 * 换算规则才测得动。
 *
 * 用户能调的量都是 0–10 的档位（均衡器各段是 ±12 dB），不是工程单位：
 * 「低音 6」比「100Hz 低架 +5.4dB」好懂，也给以后调换算留了余地。
 */

/** 十段均衡器的中心频率（Hz），倍频程排列 */
export const FX_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const
export const FX_BAND_COUNT = FX_BANDS.length
export const FX_BAND_MIN_DB = -12
export const FX_BAND_MAX_DB = 12
/** 低音 / 清晰度 / 声场 / 响度的档位上限 */
export const FX_LEVEL_MAX = 10

export type FxPresetId =
  | 'flat'
  | 'pop'
  | 'rock'
  | 'vocal'
  | 'classical'
  | 'electronic'
  | 'jazz'
  | 'bass'
  | 'live'

/** 一套音效：均衡器十段 + 四个档位 */
export interface FxTuning {
  /** 各段增益（dB），长度 FX_BAND_COUNT */
  bands: number[]
  /** 低音增强 0–10 */
  bass: number
  /** 高频清晰度 0–10 */
  clarity: number
  /** 声场拓宽 0–10 */
  width: number
  /** 响度增强 0–10 */
  loudness: number
}

export interface FxSettings extends FxTuning {
  enabled: boolean
  /** 当前套用的预设；手动动过任何一项就是 custom */
  preset: FxPresetId | 'custom'
}

const flatBands = (): number[] => new Array<number>(FX_BAND_COUNT).fill(0)

/** 内置预设。各段依次对应 FX_BANDS：31 62 125 250 500 1k 2k 4k 8k 16k */
export const FX_PRESETS: Record<FxPresetId, FxTuning> = {
  flat: { bands: flatBands(), bass: 0, clarity: 0, width: 0, loudness: 0 },
  pop: { bands: [-1, 1, 3, 2, 0, -1, 0, 2, 3, 2], bass: 2, clarity: 3, width: 2, loudness: 3 },
  rock: { bands: [4, 3, 2, 0, -1, -1, 1, 3, 4, 3], bass: 4, clarity: 3, width: 3, loudness: 4 },
  vocal: { bands: [-2, -2, -1, 1, 3, 4, 4, 2, 1, 0], bass: 0, clarity: 4, width: 1, loudness: 2 },
  classical: { bands: [2, 2, 1, 0, 0, 0, 0, 1, 2, 3], bass: 1, clarity: 2, width: 4, loudness: 0 },
  electronic: { bands: [5, 4, 2, 0, -2, 0, 1, 3, 4, 4], bass: 6, clarity: 4, width: 4, loudness: 4 },
  jazz: { bands: [2, 2, 1, 2, -1, -1, 0, 1, 2, 3], bass: 2, clarity: 2, width: 3, loudness: 1 },
  // 31Hz 合计约 +8dB。原先 +13dB 时在响的母带上限幅器压得太狠，持续低音里凭空多出 -33dB 的成分
  bass: { bands: [3, 3, 2, 1, 0, 0, 0, 0, 0, 0], bass: 6, clarity: 0, width: 0, loudness: 1 },
  live: { bands: [1, 2, 2, 1, 0, 1, 2, 2, 3, 2], bass: 2, clarity: 3, width: 8, loudness: 2 },
}

export const FX_PRESET_IDS = Object.keys(FX_PRESETS) as FxPresetId[]

/**
 * 拿掉了的预设 → 存档里还选着它时改套哪一个。
 * hd（高清增强）只在 2026-11 的测试包里出现过，用户听过后说不要了、现场最好（2026-11-20）。
 */
export const RETIRED_FX_PRESETS: Readonly<Record<string, FxPresetId>> = { hd: 'live' }

export const DEFAULT_FX: FxSettings = { enabled: false, preset: 'flat', ...FX_PRESETS.flat }

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.max(min, Math.min(max, n))
}

/**
 * 把（可能来自旧版本存档、可能缺字段、可能越界的）音效设置整理成能直接用的样子。
 * 存档比类型活得久：段数以后要是变了，旧存档的数组长度对不上，这里补齐 / 截断，而不是让处理链读到 undefined。
 */
export function normalizeFx(raw: Partial<FxSettings> | null | undefined): FxSettings {
  const source = raw ?? {}
  const rawBands = Array.isArray(source.bands) ? source.bands : []
  const bands = FX_BANDS.map((_, i) => clamp(rawBands[i], FX_BAND_MIN_DB, FX_BAND_MAX_DB, 0))
  const preset =
    source.preset === 'custom' || (typeof source.preset === 'string' && source.preset in FX_PRESETS)
      ? (source.preset as FxSettings['preset'])
      : 'custom'
  return {
    enabled: source.enabled === true,
    preset,
    bands,
    bass: clamp(source.bass, 0, FX_LEVEL_MAX, 0),
    clarity: clamp(source.clarity, 0, FX_LEVEL_MAX, 0),
    width: clamp(source.width, 0, FX_LEVEL_MAX, 0),
    loudness: clamp(source.loudness, 0, FX_LEVEL_MAX, 0),
  }
}

/** 这套音效是不是「什么都没动」（开着也等于直通） */
export function isNeutralFx(tuning: FxTuning): boolean {
  return (
    tuning.bass === 0 &&
    tuning.clarity === 0 &&
    tuning.width === 0 &&
    tuning.loudness === 0 &&
    tuning.bands.every(db => db === 0)
  )
}

/** 低音：100Hz 低架，每档 0.9dB，满档 +9dB */
export const FX_BASS_HZ = 100
const BASS_DB_PER_STEP = 0.9
/** 清晰度：7kHz 高架，每档 0.6dB，满档 +6dB */
export const FX_CLARITY_HZ = 7000
const CLARITY_DB_PER_STEP = 0.6
/** 声场：侧声道（左右之差）放大的倍数，每档 +0.08，满档 1.8 倍 */
const WIDTH_PER_STEP = 0.08
/** 预留余量最多压这么多，再多交给限幅器 */
const MAX_HEADROOM_DB = 9

/** 处理链各级该设成什么 */
export interface FxDerived {
  /** 整条链是否直通（没开，或者开着但全是零）：直通时连限幅器都不接，逐样本不改 */
  bypass: boolean
  /** 进链前先让出的余量（≤ 0 dB）：均衡器往上推了多少，这里先压回一部分，免得一推就削顶 */
  preGainDb: number
  bassDb: number
  bandDb: number[]
  clarityDb: number
  /** 侧声道倍数，1 = 原样 */
  width: number
  /** 响度增强用的压缩器；null = 不接 */
  compressor: { thresholdDb: number; ratio: number } | null
}

export function deriveFx(settings: FxSettings): FxDerived {
  const neutral = isNeutralFx(settings)
  const bassDb = settings.bass * BASS_DB_PER_STEP
  const clarityDb = settings.clarity * CLARITY_DB_PER_STEP
  if (!settings.enabled || neutral) {
    return {
      bypass: true,
      preGainDb: 0,
      bassDb: 0,
      bandDb: flatBands(),
      clarityDb: 0,
      width: 1,
      compressor: null,
    }
  }
  /*
   * 余量估计：各级提升不会在同一个频率上全部叠满，按经验打折相加，再只让出六成——
   * 全让出去的话「开了音效反而变小声」，剩下的峰值由链尾的限幅器接住。
   */
  const peakBoost = Math.max(0, ...settings.bands) + bassDb * 0.7 + clarityDb * 0.3
  const preGainDb = -Math.min(MAX_HEADROOM_DB, peakBoost * 0.6)
  const level = settings.loudness
  return {
    bypass: false,
    // 归一成 0，别留下 -0
    preGainDb: preGainDb === 0 ? 0 : preGainDb,
    bassDb,
    bandDb: settings.bands.slice(),
    clarityDb,
    width: 1 + settings.width * WIDTH_PER_STEP,
    compressor: level > 0 ? { thresholdDb: -8 - 1.6 * level, ratio: 2 + 0.2 * level } : null,
  }
}

export const dbToGain = (db: number): number => Math.pow(10, db / 20)

/**
 * 声场拓宽的矩阵系数（中 / 侧处理展开后的四个增益）。
 * 中 = (L+R)/2 不动，侧 = (L−R)/2 乘 width：
 *   L' = L·(1+w)/2 + R·(1−w)/2，R' 对称。
 * w = 1 时 direct = 1、cross = 0，就是原样。
 */
export function widthMatrix(width: number): { direct: number; cross: number } {
  return { direct: (1 + width) / 2, cross: (1 - width) / 2 }
}
