#!/usr/bin/env node
/**
 * README 界面截图的可复现拍摄脚本。
 *
 * 以前 docs/screenshots/ 里那几张是对着某台私人 Navidrome 手动截的：
 * 换一次皮肤、改一次版面，就没人能拍出内容一致的同一张。
 * 现在曲库来自 scripts/mock-subsonic.mjs 的固定假数据，任何人跑一次
 * 都能得到同样的图。
 *
 * 零依赖：直接用 Chrome DevTools Protocol 驱动本机已装的 Chrome，
 * Node 24 自带 WebSocket，不需要 puppeteer/playwright。
 *
 * 用法：
 *   node scripts/mock-subsonic.mjs &                       # 终端 A
 *   cd frontend && npm run dev &                           # 终端 B
 *   node scripts/shoot-screenshots.mjs --app=http://localhost:5173
 *
 * 可选参数：
 *   --app=<url>       前端地址（默认 http://localhost:5173）
 *   --server=<url>    mock 服务器地址（默认 http://localhost:4533）
 *   --out=<dir>       输出目录（默认 docs/screenshots/v3）
 *   --skin=pop|editorial|clay   皮肤（默认 pop）
 *   --dark            拍深色
 *   --mobile          375×812 窄视口（应用会切到移动端布局外壳）
 *   --no-gif          跳过正在播放的 GIF（GIF 需要 ffmpeg）
 *   --chrome=<path>   Chrome 可执行文件路径
 */

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/* ------------------------------ 参数 ------------------------------ */

const argv = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  })
)

const APP = argv.app || 'http://localhost:5173'
const SERVER = argv.server || 'http://localhost:4533'
const OUT = path.resolve(argv.out || 'docs/screenshots/v3')
const SKINS = ['pop', 'editorial', 'clay']
const SKIN = SKINS.includes(argv.skin) ? argv.skin : 'pop'
const DARK = !!argv.dark
/**
 * 窄视口档。
 *
 * 应用在 max-width:767px 时换成移动端布局外壳（useIsMobileLayout），
 * 所以这一档拍到的不是「桌面版被压窄」，而是真正会发给手机的那份界面。
 * 换皮的 CSS 有一半是给桌面版面写的，窄屏下会不会塌，只能这样看。
 */
const MOBILE = !!argv.mobile
const WANT_GIF = !argv['no-gif']
const CHROME =
  argv.chrome || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const WIDTH = MOBILE ? 375 : 1440
const HEIGHT = MOBILE ? 812 : 900
/** 2 倍图：README 在高分屏上不糊 */
const SCALE = 2

const sleep = ms => new Promise(r => setTimeout(r, ms))

/* --------------------------- 极简 CDP 客户端 --------------------------- */

class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
      }
    })
  }

  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    return new CDP(ws)
  }

  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  /**
   * 在页面里跑一段代码并拿回返回值。
   * awaitPromise 让调用方可以直接 return 一个 Promise。
   */
  async eval(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description || exceptionDetails.text)
    }
    return result.value
  }

  close() {
    this.ws.close()
  }
}

/* ------------------------------ 启动 Chrome ------------------------------ */

async function launchChrome() {
  if (!existsSync(CHROME)) {
    throw new Error(`找不到 Chrome：${CHROME}\n用 --chrome=<路径> 指定。`)
  }
  const profile = await mkdtemp(path.join(tmpdir(), 'n1ko-shot-'))
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      `--window-size=${WIDTH},${HEIGHT}`,
      // 截图要的是稳定的一帧，不是流畅的动画
      '--force-device-scale-factor=1',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  )

  // Chrome 把实际端口写在 stderr 的 "DevTools listening on ws://..." 那一行
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => reject(new Error('Chrome 启动超时')), 20000)
    child.stderr.on('data', chunk => {
      buf += chunk
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf)
      if (m) {
        clearTimeout(timer)
        resolve(m[1])
      }
    })
    child.on('exit', code => {
      clearTimeout(timer)
      reject(new Error(`Chrome 退出，code=${code}`))
    })
  })

  return { child, profile, wsUrl }
}

/* ------------------------------ 拍摄流程 ------------------------------ */

async function shoot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  })
  const file = path.join(OUT, `${name}.png`)
  await writeFile(file, Buffer.from(data, 'base64'))
  console.log(`  ✓ ${path.relative(process.cwd(), file)}`)
  return file
}

/** 等页面上出现某段文字，最多等 timeout 毫秒 */
async function waitForText(cdp, text, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    // 导航是异步的：Page.navigate 返回时 document.body 可能还不存在
    const found = await cdp.eval(
      `!!document.body && document.body.innerText.includes(${JSON.stringify(text)})`
    )
    if (found) return
    await sleep(200)
  }
  throw new Error(`等不到文字：${text}`)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  console.log(
    `拍摄 ${SKIN} / ${DARK ? 'dark' : 'light'} / ${MOBILE ? '375×812' : '1440×900'}` +
    ` → ${path.relative(process.cwd(), OUT)}`
  )

  const { child, profile, wsUrl } = await launchChrome()
  let cdp
  try {
    cdp = await CDP.connect(wsUrl)
    // 浏览器级连接开的新页签在 headless=new 下直接用第一个 page target 更省事
    const { targetInfos } = await cdp.send('Target.getTargets')
    const pageTarget = targetInfos.find(t => t.type === 'page')
    const { webSocketDebuggerUrl } = { webSocketDebuggerUrl: wsUrl.replace(/\/devtools\/browser\/.*/, `/devtools/page/${pageTarget.targetId}`) }
    cdp.close()
    cdp = await CDP.connect(webSocketDebuggerUrl)

    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: SCALE,
      mobile: MOBILE,
    })

    /* --- 1. 连接服务器（顺手就是「连接」那张图） --- */
    console.log('· 打开应用')
    await cdp.send('Page.navigate', { url: APP })
    await waitForText(cdp, 'Navidrome')
    await sleep(900)
    await shoot(cdp, 'login')

    console.log('· 登录 mock 服务器')
    await cdp.eval(`
      (() => {
        const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Navidrome'))
        b.click()
      })()
    `)
    await waitForText(cdp, '连接服务器')
    // React 受控输入：必须走原生 setter 再派发 input 事件，直接赋 value 不生效
    await cdp.eval(`
      (() => {
        const set = (el, v) => {
          const proto = Object.getPrototypeOf(el)
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }
        const inputs = [...document.querySelectorAll('input')]
        const byPlaceholder = p => inputs.find(i => (i.placeholder || '').includes(p))
        set(byPlaceholder('Navidrome') || inputs[0], 'N1KO 演示曲库')
        set(byPlaceholder('music.example.com') || inputs[1], ${JSON.stringify(SERVER)})
        set(byPlaceholder('admin') || inputs[2], 'demo')
        set(inputs.find(i => i.type === 'password'), 'demo')
      })()
    `)
    await sleep(200)
    await cdp.eval(`
      (() => {
        const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('连接服务器'))
        b.click()
      })()
    `)
    await waitForText(cdp, '最近添加', 20000)

    /* --- 2. 应用皮肤与明暗 --- */
    await cdp.eval(`
      (() => {
        const raw = JSON.parse(localStorage.getItem('msp-theme-store') || '{}')
        raw.state = Object.assign({}, raw.state, {
          skin: ${JSON.stringify(SKIN)},
          theme: ${JSON.stringify(DARK ? 'dark' : 'light')},
          resolvedTheme: ${JSON.stringify(DARK ? 'dark' : 'light')},
        })
        localStorage.setItem('msp-theme-store', JSON.stringify(raw))
      })()
    `)
    await cdp.send('Page.reload')
    await waitForText(cdp, '最近添加', 20000)
    // 封面是懒加载的，给 IntersectionObserver 和图片解码留出时间
    await sleep(2500)

    /*
     * 先放一首再拍首页：空着的播放条只写着「选择一首歌曲开始播放」，
     * 那是应用最不像自己的一刻。README 里应该是它正在干活的样子。
     */
    await cdp.eval(`
      (() => {
        const b = [...document.querySelectorAll('button')].find(x => /播放整张专辑/.test(x.textContent))
        if (b) b.click()
      })()
    `)
    await sleep(1800)

    console.log('· 首页')
    await shoot(cdp, 'home')

    /* --- 3. 专辑详情 --- */
    console.log('· 专辑详情')
    await cdp.eval(`location.hash=''; location.pathname='/albums/al-1'; true`)
    await waitForText(cdp, '风过留痕', 15000)
    await sleep(2000)
    await shoot(cdp, 'album')

    /* --- 4. 正在播放（先放一首，再展开全屏） --- */
    console.log('· 正在播放')
    await cdp.eval(`
      (() => {
        const b = [...document.querySelectorAll('button')].find(x => /播放全部/.test(x.textContent))
        if (b) b.click()
      })()
    `)
    await sleep(1500)
    /*
     * 进正在播放的门在两套外壳里不是同一个：桌面版是播放条右侧的歌词/全屏键，
     * 移动端根本没有播放条，只有底部那条迷你播放器——点它本身才展开。
     * 用同一个选择器去找会在窄屏下拿到 undefined 然后整轮拍摄失败。
     */
    await cdp.eval(`
      (() => {
        const match = ${MOBILE ? '/打开正在播放/' : '/歌词|全屏/'}
        const b = [...document.querySelectorAll('button')].find(x => match.test(x.getAttribute('aria-label') || ''))
        if (b) b.click()
      })()
    `)
    await sleep(2500)
    await shoot(cdp, 'player')

    /* --- 5. 正在播放的 GIF：逐句点歌词，录下歌词流动 --- */
    if (WANT_GIF) {
      console.log('· 正在播放 GIF（逐句点歌词）')
      const framesDir = await mkdtemp(path.join(tmpdir(), 'n1ko-frames-'))
      const FRAMES = 14
      for (let i = 0; i < FRAMES; i++) {
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
        await writeFile(path.join(framesDir, `f${String(i).padStart(3, '0')}.png`), Buffer.from(data, 'base64'))
        // 点下一句歌词：这是应用真实支持的「点歌词跳转」，不是特效
        await cdp.eval(`
          (() => {
            const lines = [...document.querySelectorAll('p')].filter(p => p.className.includes('lyric-line'))
            const cur = lines.findIndex(p => p.className.includes('is-active'))
            const next = lines[Math.min(lines.length - 1, cur + 1)]
            if (next) next.click()
          })()
        `)
        await sleep(420)
      }
      await buildGif(framesDir, path.join(OUT, 'player.gif'))
      await rm(framesDir, { recursive: true, force: true })
    }

    console.log('\n完成。')
    const files = await readdir(OUT)
    console.log(files.map(f => `  ${path.join(path.relative(process.cwd(), OUT), f)}`).join('\n'))
  } finally {
    cdp?.close()
    child.kill()
    await rm(profile, { recursive: true, force: true }).catch(() => {})
  }
}

/** 用 ffmpeg 把帧合成 GIF（两遍：先生成调色板，再套用，否则糖果色会脏） */
function buildGif(framesDir, outFile) {
  const palette = path.join(framesDir, 'palette.png')
  const run = args =>
    new Promise((resolve, reject) => {
      const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })
      p.on('exit', c => (c === 0 ? resolve() : reject(new Error(`ffmpeg 退出 ${c}`))))
      p.on('error', reject)
    })
  const input = ['-framerate', '2.4', '-i', path.join(framesDir, 'f%03d.png')]
  const scale = 'scale=1000:-1:flags=lanczos'
  return run([...input, '-vf', `${scale},palettegen=stats_mode=diff`, palette])
    .then(() =>
      run([
        ...input,
        '-i', palette,
        '-lavfi', `${scale} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=3`,
        '-loop', '0',
        outFile,
      ])
    )
    .then(() => console.log(`  ✓ ${path.relative(process.cwd(), outFile)}`))
    .catch(err => console.warn(`  ! GIF 跳过：${err.message}（需要 ffmpeg）`))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
