/**
 * 音效处理链（Web Audio）。
 *
 *   <audio>（音源）→ 预留余量 → 低架 → 十段均衡 → 高架 → 声场矩阵 → [压缩] → [限幅 → 软削波] → 音量 → 出声
 *
 * 出声有两条路：
 * - destination：直接接到 AudioContext 的输出（桌面壳、浏览器）。
 * - stream：接到 MediaStreamDestination，再由第二个 <audio> 把这条流放出来（iOS / iPadOS）。
 *   iOS 上 App 一进后台或锁屏，接着输出的 AudioContext 会被系统打成 interrupted、整条链停摆——
 *   开了音效就等于锁屏没声。而「不接输出、只做处理」的 AudioContext 不受这条限制，
 *   声音交给一个普通的 <audio> 去放，后台照常出声（模拟器里切后台、锁屏各验过）。
 *
 * 链里只有线性处理（均衡、搁架、声场矩阵）是一直接着的：增益 0 的 biquad 就是直通，不必为「没动」重新接线。
 * 压缩器、限幅器和软削波保险都会动到响的母带，所以只在用得上时接；整条链直通（没开 / 全零）时一个都不接，链内不改动样本。
 *
 * 不要往链里加「生成谐波」的非线性处理（整流、饱和之类的激励器 / 心理声学低音）：2026-11-20 试过，
 * 在真实音乐上就是八度法兹，多个音互相调制出一片杂音，用户一听就是失真。离线用多音信号量过，混入比例调到
 * 「听得出区别」的程度，凭空多出的成分在 -7 到 -23dB（几十个百分点），线性处理是 -120dB 以下。
 */
import { FX_BANDS, FX_BASS_HZ, FX_CLARITY_HZ, dbToGain, widthMatrix, type FxDerived } from './model'

export type FxOutput = 'destination' | 'stream'

/** 参数变化的平滑时间常数（秒）：拖滑块时不出「拉链」噪声 */
const SMOOTH_SEC = 0.03
/** 限幅门限（dBFS） */
const LIMITER_THRESHOLD_DB = -1
/** 限幅器之后再收一点：DynamicsCompressor 自带的补偿增益会把峰值顶回门限以上 */
const LIMITER_TRIM_DB = -0.5
/**
 * 最后一道保险：软削波从这里（约 -0.5dBFS）开始弯，最高顶到 1.0。
 * DynamicsCompressor 只有几毫秒预读、攻击时间也不是零，鼓点的头几个采样会冲过门限 0.5–1dB——
 * 离线量过，不加这一道会有零星采样超过 0dBFS，到蓝牙编码器那里就是削顶的「咔」。
 */
const SAFETY_KNEE = 0.944
/** 软削波曲线覆盖的输入范围 ±SAFETY_RANGE（曲线只能定义在 ±1 上，所以先乘 1/SAFETY_RANGE 再查表） */
const SAFETY_RANGE = 2
/** 响度压缩器的起控 / 释放（秒） */
const COMPRESSOR_ATTACK_SEC = 0.03
const COMPRESSOR_RELEASE_SEC = 0.5
/** 限幅器释放（秒）。放慢到 0.6s 量过，失真几乎不变（剩下的来自起控压低音波峰），不值得多出来的「憋气」 */
const LIMITER_RELEASE_SEC = 0.25

type AudioContextCtor = typeof AudioContext

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as Window & { webkitAudioContext?: AudioContextCtor }
  return window.AudioContext ?? w.webkitAudioContext ?? null
}

export function webAudioAvailable(output: FxOutput): boolean {
  const Ctor = audioContextCtor()
  if (!Ctor) return false
  return output === 'destination' || typeof Ctor.prototype.createMediaStreamDestination === 'function'
}

/**
 * 输出保险的曲线：|x| ≤ 膝点原样（分段线性，线性插值下逐样本不变），膝点以上用 tanh 弯向 1.0。
 * 横轴是缩小了 SAFETY_RANGE 倍的输入。
 */
function safetyCurve(points = 8193): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points)
  const room = 1 - SAFETY_KNEE
  for (let i = 0; i < points; i++) {
    const x = ((i / (points - 1)) * 2 - 1) * SAFETY_RANGE
    const a = Math.abs(x)
    const y = a <= SAFETY_KNEE ? a : SAFETY_KNEE + room * Math.tanh((a - SAFETY_KNEE) / room)
    curve[i] = Math.sign(x) * y
  }
  return curve
}

function chain(nodes: AudioNode[]): void {
  for (let i = 1; i < nodes.length; i++) nodes[i - 1].connect(nodes[i])
}

/**
 * 处理链本身：不管音源从哪来、声音去哪，`input` 进、`output` 出。
 * 离线渲染（OfflineAudioContext）也能直接建这一段，用来量频谱。
 */
export class FxChain {
  readonly input: GainNode
  readonly output: GainNode

  private readonly ctx: BaseAudioContext
  private readonly bass: BiquadFilterNode
  private readonly bands: BiquadFilterNode[]
  private readonly clarity: BiquadFilterNode
  private readonly direct: [GainNode, GainNode]
  private readonly cross: [GainNode, GainNode]
  private readonly merger: ChannelMergerNode
  private readonly compressor: DynamicsCompressorNode
  private readonly limiter: DynamicsCompressorNode
  private readonly trim: GainNode
  private readonly safety: WaveShaperNode
  /** 当前链尾接法，避免重复接线 */
  private tail: 'none' | 'bypass' | 'limit' | 'compress' = 'none'

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx
    this.input = ctx.createGain()
    // 单声道文件也按立体声走完全程：后面的声场矩阵要两路输入
    this.input.channelCount = 2
    this.input.channelCountMode = 'explicit'
    this.input.channelInterpretation = 'speakers'

    this.bass = ctx.createBiquadFilter()
    this.bass.type = 'lowshelf'
    this.bass.frequency.value = FX_BASS_HZ

    this.bands = FX_BANDS.map(hz => {
      const band = ctx.createBiquadFilter()
      band.type = 'peaking'
      band.frequency.value = hz
      // 倍频程排列的十段：Q≈1.41 时相邻两段的钟形刚好接上
      band.Q.value = 1.41
      return band
    })

    this.clarity = ctx.createBiquadFilter()
    this.clarity.type = 'highshelf'
    this.clarity.frequency.value = FX_CLARITY_HZ

    const splitter = ctx.createChannelSplitter(2)
    this.merger = ctx.createChannelMerger(2)
    this.direct = [ctx.createGain(), ctx.createGain()]
    this.cross = [ctx.createGain(), ctx.createGain()]
    this.cross[0].gain.value = 0
    this.cross[1].gain.value = 0
    chain([this.input, this.bass, ...this.bands, this.clarity, splitter])
    // 左出 = 左·direct + 右·cross；右出对称
    splitter.connect(this.direct[0], 0)
    splitter.connect(this.cross[0], 1)
    splitter.connect(this.direct[1], 1)
    splitter.connect(this.cross[1], 0)
    this.direct[0].connect(this.merger, 0, 0)
    this.cross[0].connect(this.merger, 0, 0)
    this.direct[1].connect(this.merger, 0, 1)
    this.cross[1].connect(this.merger, 0, 1)

    /*
     * 响度压缩器起控、释放都放慢：快了会在低音的一个周期里来回调增益，把增益起伏调制到波形上，
     * 就是听得见的失真（离线多音信号量过：起控 10ms / 释放 250ms 时响段落凭空多出 -27dB 的成分）。
     */
    this.compressor = ctx.createDynamicsCompressor()
    this.compressor.knee.value = 12
    this.compressor.attack.value = COMPRESSOR_ATTACK_SEC
    this.compressor.release.value = COMPRESSOR_RELEASE_SEC

    this.limiter = ctx.createDynamicsCompressor()
    this.limiter.threshold.value = LIMITER_THRESHOLD_DB
    this.limiter.knee.value = 0
    this.limiter.ratio.value = 20
    this.limiter.attack.value = 0.003
    this.limiter.release.value = LIMITER_RELEASE_SEC

    // 限幅器之后固定接着：修正增益 → 软削波保险。trim 顺带把输入缩到曲线的定义域里
    this.trim = ctx.createGain()
    this.trim.gain.value = dbToGain(LIMITER_TRIM_DB) / SAFETY_RANGE
    this.limiter.connect(this.trim)
    this.safety = ctx.createWaveShaper()
    this.safety.curve = safetyCurve()
    this.trim.connect(this.safety)

    this.output = ctx.createGain()
    this.wireTail('bypass')
  }

  /** 照 deriveFx 的结果设参数；链尾（压缩 / 限幅）的接法变了才重新接线 */
  apply(derived: FxDerived): void {
    const now = this.ctx.currentTime
    const set = (param: AudioParam, value: number) => param.setTargetAtTime(value, now, SMOOTH_SEC)
    set(this.input.gain, dbToGain(derived.preGainDb))
    set(this.bass.gain, derived.bassDb)
    this.bands.forEach((band, i) => set(band.gain, derived.bandDb[i] ?? 0))
    set(this.clarity.gain, derived.clarityDb)
    const { direct, cross } = widthMatrix(derived.width)
    for (const node of this.direct) set(node.gain, direct)
    for (const node of this.cross) set(node.gain, cross)
    if (derived.compressor) {
      set(this.compressor.threshold, derived.compressor.thresholdDb)
      set(this.compressor.ratio, derived.compressor.ratio)
    }
    this.wireTail(derived.bypass ? 'bypass' : derived.compressor ? 'compress' : 'limit')
  }

  /** 主音量（含归一化、渐弱）：走链尾的增益，源元素自己的音量保持满格 */
  setVolume(value: number): void {
    const v = Math.max(0, Math.min(1, value))
    this.output.gain.setTargetAtTime(v, this.ctx.currentTime, 0.008)
  }

  private wireTail(next: 'bypass' | 'limit' | 'compress'): void {
    if (this.tail === next) return
    if (this.tail !== 'none') {
      this.merger.disconnect()
      this.compressor.disconnect()
      this.safety.disconnect()
    }
    if (next === 'bypass') {
      this.merger.connect(this.output)
    } else if (next === 'limit') {
      this.merger.connect(this.limiter)
      this.safety.connect(this.output)
    } else {
      this.merger.connect(this.compressor)
      this.compressor.connect(this.limiter)
      this.safety.connect(this.output)
    }
    this.tail = next
  }
}

/** 一个 <audio> 接上处理链、再接到出声处 */
export class FxGraph {
  readonly ctx: AudioContext
  readonly output: FxOutput
  /** stream 路径上真正出声的那个元素；destination 路径为 null */
  readonly sink: HTMLAudioElement | null
  private readonly chain: FxChain

  constructor(element: HTMLAudioElement, output: FxOutput) {
    const Ctor = audioContextCtor()
    if (!Ctor) throw new Error('Web Audio is not available')
    // playback：缓冲取大不取小——这是听歌，不是合成器，多几十毫秒延迟换更省电、更不容易爆音
    this.ctx = new Ctor({ latencyHint: 'playback' })
    this.output = output
    const ctx = this.ctx
    this.chain = new FxChain(ctx)
    ctx.createMediaElementSource(element).connect(this.chain.input)

    if (output === 'stream') {
      const destination = ctx.createMediaStreamDestination()
      destination.channelCount = 2
      this.chain.output.connect(destination)
      const sink = new Audio()
      sink.srcObject = destination.stream
      this.sink = sink
    } else {
      this.chain.output.connect(ctx.destination)
      this.sink = null
    }
  }

  get running(): boolean {
    return this.ctx.state === 'running'
  }

  /** 试着把上下文叫起来（浏览器里要在用户手势内才成；App 壳里没有这个限制） */
  resume(): void {
    if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') {
      void this.ctx.resume().catch(() => { /* 没有手势时会被拒，等下一次 */ })
    }
  }

  apply(derived: FxDerived): void {
    this.chain.apply(derived)
  }

  setVolume(value: number): void {
    this.chain.setVolume(value)
  }
}
