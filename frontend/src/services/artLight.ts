/**
 * 房间的光（v6 舞台光的签名）：从封面里取出主色相与副色相。
 *
 * 只取「色相 + 饱和度」，亮度由 index.css 按主题锁死——所以无论封面多亮多暗，
 * 外壳上的文字对比都不变。结果写成数字进 CSS 变量（--art-h / --art-c / …），
 * 颜色本身由 token 拼出来，组件里不出现任何字面颜色。
 *
 * 取色在主线程做，但只读一张 40×40 的缩略图（约 1ms），且排在空闲时段。
 * 封面服务器不给 CORS 时画布会被污染、读不出像素：这时退回默认的「场灯」青柠，不报错。
 */

import { rgbToOklch, hueDistance } from '@/lib/oklch'
import { STORAGE_KEYS } from '@/services/storageKeys'

export interface ArtSwatch {
  l: number
  c: number
  h: number
}

export interface ArtPalette {
  /** 主色相（0–360）与它的饱和度 */
  h: number
  c: number
  /** 主色的平均亮度（0–1），只给舞台的光场用 */
  l: number
  /** 副色相：与主色拉开至少 40°；封面单色时取主色的邻近色 */
  h2: number
  c2: number
  /** 按权重排的最多 4 个色块（舞台光场的光源） */
  swatches: ArtSwatch[]
  /** 近乎黑白的封面：房间只留极淡的一点颜色 */
  neutral: boolean
}

/** 没有封面、或读不到像素时的「场灯」：品牌青柠，与 index.css 的默认值一致 */
export const HOUSE_LIGHTS: ArtPalette = {
  h: 127,
  c: 0.12,
  l: 0.62,
  h2: 158,
  c2: 0.08,
  swatches: [
    { l: 0.62, c: 0.12, h: 127 },
    { l: 0.5, c: 0.08, h: 158 },
  ],
  neutral: false,
}

const SAMPLE = 40
const BINS = 24
const CACHE_LIMIT = 240

/* ---------------- 缓存：内存一份，localStorage 一份（键 msp-art-light，可随时清掉重算） ---------------- */

const memory = new Map<string, ArtPalette>()
let diskLoaded = false

function cacheKey(url: string): string {
  // 鉴权参数（t / s / token）每次都变，同一张封面不能因此算两遍
  try {
    const u = new URL(url, location.href)
    for (const k of ['t', 's', 'token', 'u', 'p', 'v', 'c', 'f', 'api_key', 'X-Emby-Token']) u.searchParams.delete(k)
    return u.origin + u.pathname + u.search
  } catch {
    return url
  }
}

function loadDisk() {
  if (diskLoaded) return
  diskLoaded = true
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.artLight)
    if (!raw) return
    const entries = JSON.parse(raw) as Array<[string, ArtPalette]>
    for (const [k, v] of entries) if (v && typeof v.h === 'number') memory.set(k, v)
  } catch {
    /* 坏数据就当没有 */
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function saveDiskSoon() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      const entries = [...memory.entries()].slice(-CACHE_LIMIT)
      localStorage.setItem(STORAGE_KEYS.artLight, JSON.stringify(entries))
    } catch {
      /* 配额满了就只留内存里的 */
    }
  }, 1500)
}

function remember(key: string, palette: ArtPalette) {
  memory.delete(key)
  memory.set(key, palette)
  if (memory.size > CACHE_LIMIT) memory.delete(memory.keys().next().value as string)
  saveDiskSoon()
}

/** 已经算过的封面：同步拿到，首帧就能上色，不闪一下默认色 */
export function peekPalette(url: string | undefined): ArtPalette | undefined {
  if (!url) return undefined
  loadDisk()
  return memory.get(cacheKey(url))
}

/* ---------------- 取色 ---------------- */

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('cover load failed'))
    img.src = url
  })
}

/** 纯函数：给一块 RGBA 像素，算出调色板（单测与取色共用） */
export function paletteFromPixels(data: Uint8ClampedArray): ArtPalette {
  const weight = new Float64Array(BINS)
  const sumL = new Float64Array(BINS)
  const sumC = new Float64Array(BINS)
  const sumX = new Float64Array(BINS)
  const sumY = new Float64Array(BINS)
  let vivid = 0
  let counted = 0

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    counted++
    const [L, C, H] = rgbToOklch(data[i], data[i + 1], data[i + 2])
    if (C < 0.025) continue
    // 偏爱饱和、亮度居中的颜色：大片的黑、白、灰不决定房间的颜色
    const mid = Math.max(0.12, 1 - Math.abs(L - 0.62) * 1.4)
    const w = Math.pow(C, 1.4) * mid
    const bin = Math.floor(H / (360 / BINS)) % BINS
    weight[bin] += w
    sumL[bin] += L * w
    sumC[bin] += C * w
    const rad = (H * Math.PI) / 180
    sumX[bin] += Math.cos(rad) * w
    sumY[bin] += Math.sin(rad) * w
    vivid += w
  }

  if (counted === 0 || vivid < counted * 0.0015) {
    return { ...HOUSE_LIGHTS, c: 0.012, c2: 0.01, neutral: true }
  }

  // 环形平滑，免得一个色相被切在两个格子之间
  const smooth = new Float64Array(BINS)
  for (let b = 0; b < BINS; b++) {
    smooth[b] = weight[b] * 2 + weight[(b + BINS - 1) % BINS] + weight[(b + 1) % BINS]
  }

  const binColor = (b: number): ArtSwatch => {
    const w = weight[b] || 1e-9
    let h = (Math.atan2(sumY[b], sumX[b]) * 180) / Math.PI
    if (h < 0) h += 360
    return { l: sumL[b] / w, c: sumC[b] / w, h }
  }

  const order = [...smooth.keys()].sort((a, b) => smooth[b] - smooth[a])
  const swatches: ArtSwatch[] = []
  for (const b of order) {
    if (weight[b] <= 0) continue
    const sw = binColor(b)
    if (swatches.every(s => hueDistance(s.h, sw.h) >= 30)) swatches.push(sw)
    if (swatches.length === 4) break
  }

  const smoothOf = (s: ArtSwatch) => smooth[Math.floor(s.h / (360 / BINS)) % BINS]
  const main = swatches[0]
  const second = swatches.find(s => hueDistance(s.h, main.h) >= 40 && smoothOf(s) >= smooth[order[0]] * 0.12)

  const c = Math.min(0.2, Math.max(0.03, main.c))
  return {
    h: round(main.h),
    c: round(c, 3),
    l: round(main.l, 3),
    h2: round(second ? second.h : (main.h + 38) % 360),
    c2: round(second ? Math.min(0.18, Math.max(0.03, second.c)) : c * 0.7, 3),
    swatches: swatches.map(s => ({ l: round(s.l, 3), c: round(s.c, 3), h: round(s.h) })),
    neutral: false,
  }
}

function round(v: number, digits = 1) {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

const inflight = new Map<string, Promise<ArtPalette>>()

/** 取一张封面的调色板；失败时返回场灯，永不抛错 */
export function getPalette(url: string | undefined): Promise<ArtPalette> {
  if (!url) return Promise.resolve(HOUSE_LIGHTS)
  loadDisk()
  const key = cacheKey(url)
  const hit = memory.get(key)
  if (hit) return Promise.resolve(hit)
  const running = inflight.get(key)
  if (running) return running

  const job = (async () => {
    try {
      const img = await loadImage(url)
      const canvas = document.createElement('canvas')
      canvas.width = SAMPLE
      canvas.height = SAMPLE
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return HOUSE_LIGHTS
      ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE)
      const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE)
      const palette = paletteFromPixels(data)
      remember(key, palette)
      return palette
    } catch {
      // 跨域污染、404、解码失败：房间保持场灯
      return HOUSE_LIGHTS
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, job)
  return job
}

/** 把调色板写进根元素：外壳里所有 --wash / --stage 都从这里派生 */
export function applyPalette(palette: ArtPalette, el: HTMLElement = document.documentElement) {
  el.style.setProperty('--art-h', String(palette.h))
  el.style.setProperty('--art-c', String(palette.c))
  el.style.setProperty('--art-h2', String(palette.h2))
  el.style.setProperty('--art-c2', String(palette.c2))
}
