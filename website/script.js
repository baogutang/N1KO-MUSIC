/**
 * N1KO MUSIC 官网的全部交互：
 *  - 中 / 英切换（data-i18n 节点换 innerHTML，语言存 localStorage）
 *  - 整站换肤：糖果·波普 / 纸·墨·朱 / 奶油·软陶，只改 <html> 的 data-skin，
 *    并联动更换封面截图（和产品一样，"三张皮肤，一键切换"）
 *  - 界面画廊 tab 切换（含键盘左右键、caption 与 alt 跟随）
 *  - IntersectionObserver 入场动效（CSS 侧已按 prefers-reduced-motion 兜底）
 * 没有框架、没有构建步骤——GitHub Pages 推上去就能跑。
 */
;(function () {
  'use strict'

  /* ── 双语词典：值允许内嵌 <br /> 等行内标记（与 HTML 里的一致） ── */
  var ZH = {
    'nav.gallery': '界面', 'nav.departments': '栏目', 'nav.sources': '音源',
    'nav.privacy': '隐私', 'nav.download': '下载', 'nav.github': 'GitHub',
    'cover.rule.mid': '2026 年 10 月 · 逢月出刊',
    'cover.deck': '一本可以播放的音乐杂志',
    'cover.decksub': 'A MUSIC MAGAZINE YOU CAN PLAY — 把你的曲库，读成一本排好版的刊物',
    'cover.line1': '连上你的曲库——NAS 与流媒体，并排而坐',
    'cover.line2': '三张皮肤，一键切换——本页右上角就能试',
    'cover.line3': '四个栏目：播放 · 操作 · 曲库 · 你自己的',
    'cover.line4': '隐私，直接说清楚——TELEMETRY: NONE.',
    'cover.caption.pop': '封面图 — 首页 · 糖果·波普：糖果色各自绑定一个含义',
    'cover.caption.editorial': '封面图 — 首页 · 纸·墨·朱：暖纸、衬线、一种朱色',
    'cover.caption.clay': '封面图 — 首页 · 奶油·软陶（应用内默认皮肤）：粉彩黏土，阿糯住在问候横幅里',
    'hero.cta1': '↓ 免费下载', 'hero.cta2': '★ 给个 Star',
    'hero.meta': 'macOS · Windows · Linux · Android · iOS · Web — 免费 · 开源 · 无账号 · 无埋点',
    'rh.gallery': '版面 · LAYOUTS', 'rh.dept': '栏目 · DEPARTMENTS',
    'rh.sources': '音源 · SOURCES', 'rh.privacy': '隐私 · PRIVACY', 'rh.dl': '下载 · DOWNLOAD',
    'gallery.title': '界面',
    'gallery.sub': '三张皮肤共用同一套组件，一键切换，各自有浅色与深色——点报头右侧的三个圆点，整张网页也会跟着换。',
    'gallery.tab.player': '正在播放', 'gallery.tab.pop': '首页 · 糖果·波普',
    'gallery.tab.editorial': '首页 · 纸·墨·朱', 'gallery.tab.clay': '首页 · 奶油·软陶',
    'gallery.tab.album': '专辑页', 'gallery.tab.login': '连接',
    'gallery.cap.player': '图 2 — 正在播放：当前行被柠檬黄荧光笔高亮，点任意一行跳转',
    'gallery.cap.pop': '图 3 — 首页 · 糖果·波普：糖果色各自绑定一个含义',
    'gallery.cap.editorial': '图 4 — 首页 · 纸·墨·朱：暖纸底、衬线标题、一种朱色',
    'gallery.cap.clay': '图 5 — 首页 · 奶油·软陶：粉彩黏土质感，吉祥物阿糯住在问候横幅里',
    'gallery.cap.album': '图 6 — 专辑页：曲目读成目录，说明与规格立牌在侧',
    'gallery.cap.login': '图 7 — 连接：NAS 几秒连上；网易云 / QQ 音乐（QQ 或微信）扫个码',
    'dept.title': '栏目', 'dept.sub': '四个常设栏目，像一本杂志的版面分工。',
    'dept.playback': '播放',
    'dept.playback.1': '真正的全库随机——从服务器抽样，队列显示真实顺序',
    'dept.playback.2': '无损直通 + 三档码率，Wi-Fi 与蜂窝分别设置自动切换',
    'dept.playback.3': 'ReplayGain 用服务器算好的增益，母带不再忽大忽小',
    'dept.playback.4': '队列不会停：相似曲目自动接，任何种子都能开电台',
    'dept.playback.5': '继续听与跨设备续播，断点取自服务器书签',
    'dept.control': '操作',
    'dept.control.1': '每个列表都能多选批量操作：点选、连选、长按',
    'dept.control.2': '完整 Media Session：SMTC / Now Playing / MPRIS / 锁屏',
    'dept.control.3': '拔耳机立刻暂停，一分钟内插回接着放',
    'dept.control.4': '车载模式：超大触控目标、滑动切歌、屏幕常亮',
    'dept.control.5': 'n1ko:// 深链接、⌘K 面板、全键盘、滚动记忆',
    'dept.library': '曲库',
    'dept.library.1': '虚拟滚动 + 离线元数据缓存，一万首也不卡',
    'dept.library.2': '内页说明与规格立牌：ISRC、位深、采样率、真实码率',
    'dept.library.3': '唱片目录年份轨——作品读成一条生涯，不是封面墙',
    'dept.library.4': '把队列存成歌单，存的是你刚听到的顺序',
    'dept.library.5': '分享、评分、重扫——只在服务器确实支持时出现',
    'dept.yours': '你自己的',
    'dept.yours.1': '《本期》：每个月自动成为一期，编者按一个字不编',
    'dept.yours.2': '重听——去年今日、久违、只听过一次',
    'dept.yours.3': '边注：唯一不能被重算的数据，优先同步与备份',
    'dept.yours.4': '可改的口味画像：权重摊开看，歌手曲风可永久关掉',
    'dept.yours.5': '导入 ListenBrainz / Last.fm；导出 M3U8 / XSPF / JSON / CSV',
    'sources.title': '连上你的曲库',
    'sources.sub': '两种来源并排而坐，不是二选一。搜索按来源分组，队列里混着放。',
    'sources.nas': '自建服务器 · YOUR SERVER', 'sources.recommended': '推荐',
    'sources.streaming': '流媒体音源 · STREAMING（扫码登录）',
    'sources.netease': '网易云音乐', 'sources.qq': 'QQ 音乐',
    'sources.note': '可选能力是<b>探测出来的，不是假设的</b>——服务器没实现哪一项，那个入口就整个不出现。流媒体只放你账号有权听的内容，VIP 曲目会标明原因，不做任何「解析」。',
    'sandbox.1t': '脚本沙箱', 'sandbox.1b': '音源是兼容 MusicFree 协议的插件，不能碰页面，不能自己联网。',
    'sandbox.2t': '白名单代理', 'sandbox.2b': '一切请求经宿主代理，manifest 列出的域名才放行，重定向逐跳复查。',
    'sandbox.3t': '凭据本机加密', 'sandbox.3b': '与服务器密码同一把 AES-GCM 设备密钥，只存在本机，不经过第三方。',
    'privacy.title': '隐私，直接说清楚',
    'privacy.stamp1': 'TELEMETRY: NONE.',
    'privacy.stamp2': '没有埋点，没有崩溃上报——也没有可以发过去的服务器。',
    'privacy.r1k': '你的音乐', 'privacy.r1v': '你的音乐服务器（NAS），以及你登录过的插件音源。没有别处。',
    'privacy.r2k': '历史 · 统计 · 口味画像', 'privacy.r2v': '这台设备（IndexedDB），以及你自己跑的同步服务（如果有）。',
    'privacy.r3k': '凭据', 'privacy.r3v': '用页面脚本取不出来的 AES-GCM 密钥加密落盘。',
    'privacy.r4k': '导出文件', 'privacy.r4v': '在浏览器里生成，不上传。',
    'privacy.r5k': 'ListenBrainz / MusicBrainz', 'privacy.r5v': '可选，默认关闭。后者只发歌手编号。',
    'dl.title': '下载', 'dl.sub': '完全免费，完全开源。挑你的平台，几秒钟开始。',
    'dl.macarm': 'Apple 芯片', 'dl.macintel': 'Intel', 'dl.win': '安装包或 MSI',
    'dl.linux': '免安装或 DEB 包', 'dl.android': '工作流 Artifacts 下载', 'dl.ios': 'AltStore / Sideloadly 侧载',
    'dl.note': 'macOS 首次打开若提示「无法验证开发者」，到「系统设置 → 隐私与安全性」里允许即可；若提示「已损坏」，终端执行 xattr -cr "/Applications/N1KO MUSIC.app" 后再打开。不想装应用？用 Docker 跑 Web 版，一条命令。',
    'footer.end': '—— 本期完 ——', 'footer.type': '字体 / TYPE',
    'footer.selfhosted': '全部自托管，不走第三方 CDN。', 'footer.stack': '技术 / STACK',
    'footer.promo': '同作者 / ALSO', 'footer.promo.body': '一个 key 打通 Claude / GPT / Gemini，按量计费。',
    'footer.star': '如果 N1KO MUSIC 对你有用，一颗 ★ 意义重大。',
  }

  var EN = {
    'nav.gallery': 'Gallery', 'nav.departments': 'Departments', 'nav.sources': 'Sources',
    'nav.privacy': 'Privacy', 'nav.download': 'Download', 'nav.github': 'GitHub',
    'cover.rule.mid': 'OCTOBER 2026 · PUBLISHED MONTHLY',
    'cover.deck': 'A music magazine you can play',
    'cover.decksub': '一本可以播放的音乐杂志 — YOUR LIBRARY, TYPESET LIKE AN ISSUE',
    'cover.line1': 'Connect your library — NAS and streaming, side by side',
    'cover.line2': 'Three skins, one click apart — try the dots, top right',
    'cover.line3': 'Four departments: Playback · Control · Library · Yours',
    'cover.line4': 'Privacy, stated plainly — TELEMETRY: NONE.',
    'cover.caption.pop': 'Cover art — Home, Candy Pop: every candy colour is bound to a meaning',
    'cover.caption.editorial': 'Cover art — Home, Paper & Ink: warm paper, serifs, one vermilion',
    'cover.caption.clay': 'Cover art — Home, Soft Clay (default): pastel claymorphism, home to Nuo the mascot',
    'hero.cta1': '↓ Download free', 'hero.cta2': '★ Star on GitHub',
    'hero.meta': 'macOS · Windows · Linux · Android · iOS · Web — free · open source · no account · no telemetry',
    'rh.gallery': 'LAYOUTS · 版面', 'rh.dept': 'DEPARTMENTS · 栏目',
    'rh.sources': 'SOURCES · 音源', 'rh.privacy': 'PRIVACY · 隐私', 'rh.dl': 'DOWNLOAD · 下载',
    'gallery.title': 'Gallery',
    'gallery.sub': 'Three skins, one set of components, one click apart — each with light and dark. Try the three dots in the masthead: the whole site switches too.',
    'gallery.tab.player': 'Now Playing', 'gallery.tab.pop': 'Home · Candy Pop',
    'gallery.tab.editorial': 'Home · Paper & Ink', 'gallery.tab.clay': 'Home · Soft Clay',
    'gallery.tab.album': 'Album page', 'gallery.tab.login': 'Connect',
    'gallery.cap.player': 'Fig. 2 — Now Playing: the current row gets a lemon highlighter; tap any row to jump',
    'gallery.cap.pop': 'Fig. 3 — Home, Candy Pop: every candy colour is bound to a meaning',
    'gallery.cap.editorial': 'Fig. 4 — Home, Paper & Ink: warm paper, serif headlines, one vermilion',
    'gallery.cap.clay': 'Fig. 5 — Home, Soft Clay: pastel claymorphism, home to Nuo the mascot',
    'gallery.cap.album': 'Fig. 6 — Album page: tracks read like a table of contents',
    'gallery.cap.login': 'Fig. 7 — Connect: NAS in seconds; NetEase / QQ Music (QQ or WeChat QR) with a scan',
    'dept.title': 'Departments', 'dept.sub': 'Four standing departments, like a magazine’s division of pages.',
    'dept.playback': 'Playback',
    'dept.playback.1': 'True whole-library shuffle — sampled server-side, the queue shows the real order',
    'dept.playback.2': 'Lossless passthrough + three bitrates; Wi-Fi and cellular set separately',
    'dept.playback.3': 'ReplayGain from server-computed gain — masters stop jumping in volume',
    'dept.playback.4': 'The queue never stalls: similar tracks auto-follow, any seed starts a radio',
    'dept.playback.5': 'Resume listening across devices; bookmarks come from the server',
    'dept.control': 'Control',
    'dept.control.1': 'Multi-select batch actions in every list: tap, range-select, long-press',
    'dept.control.2': 'Full Media Session: SMTC / Now Playing / MPRIS / lock screen',
    'dept.control.3': 'Unplug headphones → instant pause; replug within a minute → resume',
    'dept.control.4': 'Car mode: huge touch targets, swipe to skip, keep screen on',
    'dept.control.5': 'n1ko:// deep links, ⌘K palette, full keyboard, scroll memory',
    'dept.library': 'Library',
    'dept.library.1': 'Virtual scrolling + offline metadata cache — ten thousand tracks stay smooth',
    'dept.library.2': 'Liner notes and spec plates: ISRC, bit depth, sample rate, real bitrate',
    'dept.library.3': 'A year-by-year discography rail — a career, not a wall of covers',
    'dept.library.4': 'Save the queue as a playlist, in the exact order you just heard it',
    'dept.library.5': 'Share, rate, rescan — only when the server really supports it',
    'dept.yours': 'Your own',
    'dept.yours.1': '“The Issue”: every month becomes one automatically, editors’ notes write themselves',
    'dept.yours.2': 'Rediscovery — on this day, long unheard, once-only',
    'dept.yours.3': 'Marginalia: the one thing that cannot be recomputed — synced and backed up first',
    'dept.yours.4': 'An editable taste profile: weights in the open, artists and genres muteable forever',
    'dept.yours.5': 'Import ListenBrainz / Last.fm; export M3U8 / XSPF / JSON / CSV',
    'sources.title': 'Point it at your library',
    'sources.sub': 'Two kinds of sources side by side, not either-or. Search grouped by source; the queue mixes freely.',
    'sources.nas': 'Your server · SELF-HOSTED', 'sources.recommended': 'recommended',
    'sources.streaming': 'Streaming sources · STREAMING (QR sign-in)',
    'sources.netease': 'NetEase Cloud Music', 'sources.qq': 'QQ Music',
    'sources.note': 'Optional capabilities are <b>probed, never assumed</b> — if the server does not implement one, its entry simply never appears. Streaming plays only what your own account may hear; VIP tracks say why, no “unlocking”.',
    'sandbox.1t': 'Script sandbox', 'sandbox.1b': 'Each source is a MusicFree-compatible plugin — no DOM access, no direct networking.',
    'sandbox.2t': 'Allow-listed proxy', 'sandbox.2b': 'Every request is proxied by the host; only manifest-listed hosts are reached, redirects re-checked per hop.',
    'sandbox.3t': 'Credentials stay on-device', 'sandbox.3b': 'Encrypted with the same AES-GCM device key as server passwords — never sent anywhere else.',
    'privacy.title': 'Privacy, stated plainly',
    'privacy.stamp1': 'TELEMETRY: NONE.',
    'privacy.stamp2': 'No analytics, no crash reports — there is no server to send them to.',
    'privacy.r1k': 'Your music', 'privacy.r1v': 'Your music server (NAS) or the plugin sources you signed in to. Nowhere else.',
    'privacy.r2k': 'History · stats · taste profile', 'privacy.r2v': 'This device (IndexedDB), plus a sync service you run yourself (if any).',
    'privacy.r3k': 'Credentials', 'privacy.r3v': 'Encrypted at rest with an AES-GCM key page scripts cannot read.',
    'privacy.r4k': 'Exported files', 'privacy.r4v': 'Generated in the browser. Never uploaded.',
    'privacy.r5k': 'ListenBrainz / MusicBrainz', 'privacy.r5v': 'Opt-in, off by default. The latter sends artist ids only.',
    'dl.title': 'Download', 'dl.sub': 'Completely free, completely open source. Pick your platform.',
    'dl.macarm': 'Apple Silicon', 'dl.macintel': 'Intel', 'dl.win': 'Installer or MSI',
    'dl.linux': 'AppImage or DEB', 'dl.android': 'Workflow artifacts', 'dl.ios': 'AltStore / Sideloadly',
    'dl.note': 'On macOS, allow the app under System Settings → Privacy & Security on first launch; if macOS says it is “damaged”, run xattr -cr "/Applications/N1KO MUSIC.app" and open again. Prefer no install? The web version runs in Docker, one command.',
    'footer.end': '— end of issue —', 'footer.type': 'Type / TYPE',
    'footer.selfhosted': 'All self-hosted; no third-party CDN.', 'footer.stack': 'Stack / STACK',
    'footer.promo': 'Also by N1KO / ALSO', 'footer.promo.body': 'One key for Claude / GPT / Gemini, pay as you go.',
    'footer.star': 'If N1KO MUSIC is useful to you, a ★ means a lot.',
  }

  var DICTS = { zh: ZH, en: EN }
  var LANG_KEY = 'n1ko-site-lang'
  var SKIN_KEY = 'n1ko-site-skin'
  var currentLang = 'zh'

  function t(key) { return DICTS[currentLang][key] || '' }

  function applyLang(lang) {
    currentLang = lang === 'en' ? 'en' : 'zh'
    var dict = DICTS[currentLang]
    var nodes = document.querySelectorAll('[data-i18n]')
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-i18n')
      if (dict[key] !== undefined) nodes[i].innerHTML = dict[key]
    }
    document.documentElement.setAttribute('data-lang', currentLang)
    document.documentElement.setAttribute('lang', currentLang === 'en' ? 'en-US' : 'zh-CN')
    try { localStorage.setItem(LANG_KEY, currentLang) } catch (e) { /* 私密模式无所谓 */ }
  }

  var toggle = document.getElementById('langToggle')
  if (toggle) {
    toggle.addEventListener('click', function () {
      applyLang(currentLang === 'zh' ? 'en' : 'zh')
    })
  }

  /* 初始语言：?lang= 参数 > 上次选择 > 跟随系统（中文系统给中文，其它给英文） */
  try {
    var urlLang = (location.search.match(/[?&]lang=(zh|en)/) || [])[1]
    var saved = localStorage.getItem(LANG_KEY)
    if (urlLang) applyLang(urlLang)
    else if (saved === 'en' || saved === 'zh') applyLang(saved)
    else if (typeof navigator !== 'undefined' && !/^zh/i.test(navigator.language || '')) applyLang('en')
  } catch (e) { /* ignore */ }

  /* ── 整站换肤：只改 data-skin，联动换封面截图 ── */
  var SKINS = {
    pop:       { img: 'assets/home-pop.png',       themeColor: '#f6f0dc' },
    editorial: { img: 'assets/home-editorial.png', themeColor: '#f4efe3' },
    clay:      { img: 'assets/home.png',           themeColor: '#f5eee4' },
  }
  var heroImg = document.getElementById('heroImg')
  var heroCaption = document.getElementById('heroCaption')
  var skinDots = Array.prototype.slice.call(document.querySelectorAll('.skin-dot[data-skin]'))

  function applySkin(skin) {
    if (!SKINS[skin]) skin = 'clay'
    document.documentElement.setAttribute('data-skin', skin)
    for (var i = 0; i < skinDots.length; i++) {
      skinDots[i].setAttribute('aria-pressed', skinDots[i].getAttribute('data-skin') === skin ? 'true' : 'false')
    }
    if (heroImg) {
      heroImg.src = SKINS[skin].img
      heroImg.alt = t('cover.caption.' + skin).replace(/^封面图 — |^Cover art — /, '')
    }
    if (heroCaption) {
      heroCaption.setAttribute('data-i18n', 'cover.caption.' + skin)
      heroCaption.innerHTML = t('cover.caption.' + skin)
    }
    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', SKINS[skin].themeColor)
    try { localStorage.setItem(SKIN_KEY, skin) } catch (e) { /* ignore */ }
  }

  for (var d = 0; d < skinDots.length; d++) {
    ;(function (dot) {
      dot.addEventListener('click', function () { applySkin(dot.getAttribute('data-skin')) })
    })(skinDots[d])
  }

  /* 初始皮肤：?skin= 参数（可从 README/文档直接链到某张皮）> 上次选择 > 默认。
     无论如何都在载入时完整应用一次：同步封面图、图注语言与主题色。 */
  try {
    var urlSkin = (location.search.match(/[?&]skin=(pop|editorial|clay)/) || [])[1]
    var savedSkin = localStorage.getItem(SKIN_KEY)
    var initialSkin = urlSkin || (SKINS[savedSkin] ? savedSkin : document.documentElement.getAttribute('data-skin'))
    applySkin(initialSkin)
  } catch (e) { /* ignore */ }

  /* ── 画廊 ── */
  var SHOTS = {
    player:    { src: 'assets/player.gif',          alt: ['N1KO MUSIC 正在播放界面', 'N1KO MUSIC now playing'] },
    'home-pop':{ src: 'assets/home-pop.png',        alt: ['首页 · 糖果·波普', 'Home · Candy Pop'] },
    'home-editorial': { src: 'assets/home-editorial.png', alt: ['首页 · 纸·墨·朱', 'Home · Paper & Ink'] },
    home:      { src: 'assets/home.png',            alt: ['首页 · 奶油·软陶', 'Home · Soft Clay'] },
    album:     { src: 'assets/album.png',           alt: ['专辑页', 'Album page'] },
    login:     { src: 'assets/login.png',           alt: ['连接页', 'Connect'] },
  }
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.pill.tab[data-shot]'))
  var galleryImg = document.getElementById('galleryImg')
  var galleryCaption = document.getElementById('galleryCaption')

  function selectShot(name) {
    var shot = SHOTS[name]
    if (!shot || !galleryImg) return
    galleryImg.classList.add('switching')
    var swap = function () {
      galleryImg.src = shot.src
      galleryImg.alt = shot.alt[currentLang === 'en' ? 1 : 0]
      galleryImg.classList.remove('switching')
    }
    setTimeout(swap, 180)
    if (galleryCaption) {
      var key = 'gallery.cap.' + name
      galleryCaption.setAttribute('data-i18n', key)
      galleryCaption.innerHTML = t(key)
    }
    for (var i = 0; i < tabs.length; i++) {
      var active = tabs[i].getAttribute('data-shot') === name
      tabs[i].classList.toggle('active', active)
      tabs[i].setAttribute('aria-selected', active ? 'true' : 'false')
    }
  }

  for (var tb = 0; tb < tabs.length; tb++) {
    ;(function (tab) {
      tab.addEventListener('click', function () { selectShot(tab.getAttribute('data-shot')) })
    })(tabs[tb])
  }

  /* 画廊 tablist 支持左右键（WAI-ARIA tabs 模式的最小实现） */
  var tablist = document.querySelector('.gallery-tabs')
  if (tablist) {
    tablist.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      var idx = tabs.findIndex(function (tab) { return tab.classList.contains('active') })
      var next = (idx + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
      tabs[next].focus()
      selectShot(tabs[next].getAttribute('data-shot'))
    })
  }

  /* ── 入场动效：IntersectionObserver 驱动，进视口一次即定格 ── */
  /* ?snap=1 跳过入场动效（截图/调试/无 JS 动画环境兜底） */
  var SNAP = /[?&]snap\b/.test(location.search)
  var revealGroups = [
    ['.nameplate', 0], ['.deck', 60], ['.cover-lines', 120], ['.cover-art', 160],
    ['.running-head', 0], ['.section-head', 0],
    ['.gallery-tabs', 60], ['.gallery-stage', 120],
    ['.source-group', 0], ['.note-line', 80],
    ['.privacy-stamp', 0], ['.privacy-rows', 120],
    ['.colophon-grid', 0],
  ]
  var staggered = ['.dept-card', '.mini-card', '.dl-card', '.prow', '.cline']

  var observed = []
  if (!SNAP) {
    revealGroups.forEach(function (pair) {
      document.querySelectorAll(pair[0]).forEach(function (el) {
        el.classList.add('reveal')
        el.style.setProperty('--reveal-delay', pair[1] + 'ms')
        observed.push(el)
      })
    })
    staggered.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el, i) {
        el.classList.add('reveal')
        el.style.setProperty('--reveal-delay', (i % 6) * 60 + 'ms')
        observed.push(el)
      })
    })
  }

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return
        entry.target.classList.add('in')
        io.unobserve(entry.target)
      })
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' })
    observed.forEach(function (el) { io.observe(el) })
  } else {
    observed.forEach(function (el) { el.classList.add('in') })
  }
})()
