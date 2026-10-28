/**
 * 舞台的光场（全屏播放器的背景）：四盏柔光在暗场里慢慢游走，颜色取自当前封面。
 *
 * 换歌时不是整片换色，而是新颜色从封面所在的位置向外漫开（扩散转场）——
 * 新旧两组光源都在着色器里，用一个半径从 0 长到铺满的圆做分界。
 *
 * 成本控制：画布只有显示尺寸的 1/4，CSS 拉伸后本来就是柔的；30fps；
 * 页面隐藏、浮层关掉就停；减弱动态效果时只在换歌时画一帧静止的光。
 * 没有 WebGL（或上下文丢了）时退回 CSS 渐变（.stage-fallback）。
 */
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { cn } from '@/lib/utils'
import { oklchToRgb } from '@/lib/oklch'
import { prefersReducedMotion } from '@/lib/motion'
import { useArtLightStore } from '@/store/artLightStore'
import type { ArtPalette } from '@/services/artLight'

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uA[5];
uniform vec3 uB[5];
uniform float uReveal;
uniform vec2 uOrigin;
varying vec2 vUv;

vec3 field(vec3 base, vec3 c0, vec3 c1, vec3 c2, vec3 c3, vec2 uv, float t, float aspect) {
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec2 p0 = vec2(aspect * (0.22 + 0.10 * sin(t * 0.21)), 0.80 + 0.08 * cos(t * 0.17));
  vec2 p1 = vec2(aspect * (0.82 + 0.09 * cos(t * 0.19)), 0.72 + 0.10 * sin(t * 0.23));
  vec2 p2 = vec2(aspect * (0.30 + 0.12 * cos(t * 0.13)), 0.16 + 0.09 * sin(t * 0.29));
  vec2 p3 = vec2(aspect * (0.76 + 0.11 * sin(t * 0.11)), 0.24 + 0.10 * cos(t * 0.15));
  vec3 col = base;
  col += c0 * exp(-dot(p - p0, p - p0) / 0.20);
  col += c1 * exp(-dot(p - p1, p - p1) / 0.15);
  col += c2 * exp(-dot(p - p2, p - p2) / 0.14);
  col += c3 * exp(-dot(p - p3, p - p3) / 0.11);
  return col;
}

void main() {
  float aspect = uRes.x / uRes.y;
  float t = uTime;
  vec2 uv = vUv + 0.03 * vec2(sin(vUv.y * 3.1 + t * 0.30), cos(vUv.x * 2.7 - t * 0.25));
  vec3 a = field(uA[0], uA[1], uA[2], uA[3], uA[4], uv, t, aspect);
  vec3 b = field(uB[0], uB[1], uB[2], uB[3], uB[4], uv, t, aspect);
  vec2 d = vec2((vUv.x - uOrigin.x) * aspect, vUv.y - uOrigin.y);
  float rad = uReveal * length(vec2(aspect, 1.0)) * 1.1;
  float m = 1.0 - smoothstep(rad - 0.22, rad, length(d));
  vec3 col = mix(b, a, m);
  col = col / (1.0 + col * 0.4);
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) * (2.0 / 255.0);
  gl_FragColor = vec4(col, 1.0);
}`

/** 调色板 → 5 个 vec3：底色 + 四盏光（亮度压暗、饱和封顶，白字在上面始终读得清）。
 *  光的亮度封在 0.36–0.5：再亮，顶上的分段标签和歌手行就掉到 4.5:1 以下——
 *  要保住对比，降的是光的亮度，不是颜色的饱和 */
function paletteToUniform(p: ArtPalette): Float32Array {
  const out = new Float32Array(15)
  // 底色压到很暗、带一点主色相：光打在上面才通透，不发闷
  const base = oklchToRgb(0.13, Math.min(p.c * 0.4, 0.04), p.h)
  out.set(base, 0)
  const lights = [...p.swatches]
  // 单色封面只有一两个色相：补一盏更亮的同色高光、一盏更深的邻近色，让光有层次
  while (lights.length < 4) {
    const k = lights.length
    lights.push(
      k % 2
        ? { l: 0.58, c: p.c * 0.9, h: (p.h + 18) % 360 }
        : { l: 0.44, c: p.c2 * 0.9, h: (p.h2 + 360 - 14) % 360 }
    )
  }
  const gains = [0.74, 0.58, 0.48, 0.4]
  lights.slice(0, 4).forEach((sw, i) => {
    const rgb = oklchToRgb(Math.min(0.5, Math.max(0.36, sw.l)), Math.min(0.19, sw.c * 1.2), sw.h)
    out.set(rgb.map(v => v * gains[i]), 3 + i * 3)
  })
  return out
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh)
    return null
  }
  return sh
}

export function StageField({ className, originRef }: { className?: string; originRef?: RefObject<HTMLElement> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const palette = useArtLightStore(s => s.palette)
  const [failed, setFailed] = useState(false)
  const stateRef = useRef<{
    gl: WebGLRenderingContext
    uniforms: Record<string, WebGLUniformLocation | null>
    a: Float32Array
    b: Float32Array
    revealFrom: number
    origin: [number, number]
    draw: () => void
  } | null>(null)

  /* 初始化：一次。拿不到 WebGL 就退回 CSS */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'low-power' })
    if (!gl) {
      setFailed(true)
      return
    }
    const vs = compile(gl, gl.VERTEX_SHADER, VERT)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    const prog = gl.createProgram()
    if (!vs || !fs || !prog) {
      setFailed(true)
      return
    }
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      setFailed(true)
      return
    }
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'aPos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const uniforms = {
      uRes: gl.getUniformLocation(prog, 'uRes'),
      uTime: gl.getUniformLocation(prog, 'uTime'),
      uA: gl.getUniformLocation(prog, 'uA'),
      uB: gl.getUniformLocation(prog, 'uB'),
      uReveal: gl.getUniformLocation(prog, 'uReveal'),
      uOrigin: gl.getUniformLocation(prog, 'uOrigin'),
    }
    const initial = paletteToUniform(useArtLightStore.getState().palette)
    const reduce = prefersReducedMotion()
    const start = performance.now()
    let frame = 0
    let last = 0
    let running = true

    const state = {
      gl,
      uniforms,
      a: initial,
      b: initial,
      revealFrom: -1,
      origin: [0.5, 0.6] as [number, number],
      draw: () => {},
    }

    const draw = (now: number) => {
      const t = reduce ? 0 : (now - start) / 1000
      let reveal = 1
      if (state.revealFrom >= 0) {
        const k = Math.min(1, (now - state.revealFrom) / 1500)
        reveal = 1 - (1 - k) ** 3
        if (k >= 1) state.revealFrom = -1
      }
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform2f(uniforms.uRes, canvas.width, canvas.height)
      gl.uniform1f(uniforms.uTime, t)
      gl.uniform3fv(uniforms.uA, state.a)
      gl.uniform3fv(uniforms.uB, state.b)
      gl.uniform1f(uniforms.uReveal, reveal)
      gl.uniform2f(uniforms.uOrigin, state.origin[0], state.origin[1])
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    state.draw = () => draw(performance.now())

    const loop = (now: number) => {
      if (!running) return
      frame = requestAnimationFrame(loop)
      if (document.hidden) return
      // 30fps：慢慢游走的光不需要更多帧；扩散中按满帧画，边缘才顺
      if (state.revealFrom < 0 && now - last < 32) return
      last = now
      draw(now)
    }

    const resize = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth / 4))
      const h = Math.max(1, Math.round(canvas.clientHeight / 4))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      draw(performance.now())
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()

    const onLost = (e: Event) => {
      e.preventDefault()
      running = false
      setFailed(true)
    }
    canvas.addEventListener('webglcontextlost', onLost)
    stateRef.current = state
    if (!reduce) frame = requestAnimationFrame(loop)

    return () => {
      running = false
      cancelAnimationFrame(frame)
      ro.disconnect()
      canvas.removeEventListener('webglcontextlost', onLost)
      stateRef.current = null
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [])

  /* 换歌：旧颜色留在外面，新颜色从封面的位置向外漫开 */
  useEffect(() => {
    const state = stateRef.current
    if (!state) return
    const next = paletteToUniform(palette)
    state.b = state.a
    state.a = next
    const canvas = canvasRef.current
    const origin = originRef?.current
    if (canvas && origin) {
      const c = canvas.getBoundingClientRect()
      const o = origin.getBoundingClientRect()
      state.origin = [
        (o.left + o.width / 2 - c.left) / Math.max(1, c.width),
        1 - (o.top + o.height / 2 - c.top) / Math.max(1, c.height),
      ]
    }
    if (prefersReducedMotion()) {
      state.b = next
      state.draw()
      return
    }
    state.revealFrom = performance.now()
  }, [palette, originRef])

  return (
    <div aria-hidden="true" className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      {failed ? (
        <div className="stage-fallback absolute inset-0" />
      ) : (
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      )}
      {/* 顶上、底部各压暗一档：分段标签、控制区的白字始终站得住 */}
      <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-stage-deep/45 to-stage-deep/0" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-stage-deep/55 to-stage-deep/0" />
    </div>
  )
}
