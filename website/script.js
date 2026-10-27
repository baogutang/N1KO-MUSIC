/**
 * N1KO MUSIC 官网的全部交互：
 *  - 中 / 英切换（data-i18n 节点换 innerHTML，data-i18n-alt 换图片 alt，语言存 localStorage）
 *  - 「正在播放」一节的截图切换（含键盘左右键、图注与 alt 跟随）
 * v5 起应用只有一套暖纸设计，官网也不再换肤；明暗跟随系统，由 CSS 处理。
 * 没有框架、没有构建步骤：GitHub Pages 推上去就能跑。
 */
;(function () {
  'use strict'

  /* ── 双语词典：值允许内嵌 <b> <br /> 等行内标记（与 HTML 里的一致） ── */
  var ZH = {
    'nav.windows': '布局', 'nav.ipad': 'iPad', 'nav.features': '功能',
    'nav.sources': '音源', 'nav.download': '下载',
    'hero.title': '听自己的曲库',
    'hero.lede': '连上 Navidrome、Subsonic、Jellyfin 或 Emby；没有 NAS，用网易云音乐、QQ 音乐扫码也能听。',
    'hero.cta1': '免费下载', 'hero.cta2': '看看源码',
    'hero.meta': 'macOS、Windows、Linux、Android、iOS 和 Web 都能用，免费开源，不要账号，没有埋点。',
    'hero.alt': 'N1KO MUSIC 在 iPad 横屏上：侧栏、首页和正在播放面板并排',
    'hero.caption': '宽窗口：侧栏、页面和正在播放面板并排。iPad 横屏与桌面都是这一套。',
    'windows.title': '跟着窗口换布局',
    'windows.sub': '只看窗口有多宽，不看是什么设备。iPhone、展开的 iPhone Duo、iPad 分屏和桌面，各拿到合适的那一套。',
    'windows.phone': '窄窗口：底部标签栏，迷你播放条可以左右滑动切歌',
    'windows.phone.alt': 'iPhone 上的首页：底部标签栏和迷你播放条',
    'windows.duo': 'iPhone Duo 半折：歌词在折痕上方，封面和播放键在下方',
    'windows.duo.alt': 'iPhone Duo 半折时的正在播放：歌词在上，封面带和控制在下',
    'windows.ipad': '中等宽度：左侧导航条，iPad 竖屏和半屏分屏',
    'windows.ipad.alt': 'iPad 竖屏上的专辑页：左侧导航条',
    'player.title': '正在播放',
    'player.sub': '封面是界面上唯一的大块颜色。播放键是嵌在凹槽里的一颗橡胶键，歌词落在一张淡淡的格纸上。',
    'player.tab.player': '横屏', 'player.tab.dark': '深色', 'player.tab.login': '连接',
    'player.cap.player': '横着的窗口：左边封面和控制，右边歌词。点任意一行跳过去。',
    'player.cap.dark': '深色：棕墨夜色，同一盏陶土色调亮一档。跟随系统切换。',
    'player.cap.login': '连接：NAS 几秒连上；网易云音乐、QQ 音乐用手机扫个码。',
    'ipad.title': '在 iPad 上，像个 iPad 应用',
    'ipad.sub': '接上妙控键盘或触控板，桌面上那套操作都在。按住 ⌘ 一秒，屏幕上会列出全部快捷键。',
    'ipad.hold': '按住', 'ipad.k.hold': '列出全部快捷键',
    'ipad.k.nav': '首页、推荐、音乐库', 'ipad.k.search': '搜索', 'ipad.k.lyrics': '全屏歌词',
    'ipad.k.sidebar': '收起或展开侧栏', 'ipad.k.panel': '正在播放面板', 'ipad.k.history': '后退、前进',
    'ipad.rightclick': '右键', 'ipad.k.menu': '歌曲菜单，和长按一样',
    'ipad.drag': '触控板拖动', 'ipad.k.drag': '把歌拖进「接下来」或侧栏里的歌单',
    'features.title': '能做什么',
    'f.playback': '播放',
    'f.playback.1': '全库随机，从服务器抽样',
    'f.playback.2': '无损直通，或三档码率',
    'f.playback.3': '队列放完自动接相似曲目',
    'f.control': '操作',
    'f.control.1': '每个列表都能多选',
    'f.control.2': '锁屏、SMTC、MPRIS 都能控制',
    'f.control.3': '车载模式：超大按键，滑动切歌',
    'f.library': '曲库',
    'f.library.1': '一万首也不卡',
    'f.library.2': '唱片说明、位深、真实码率',
    'f.library.3': '服务器支持什么，才出现什么',
    'f.yours': '你自己的',
    'f.yours.1': '《本期》：每月一期，句子由真实数字拼成',
    'f.yours.2': '重听与边注',
    'f.yours.3': '听歌历史能导入，也能导出',
    'sources.title': '连上你的曲库',
    'sources.sub': '两种来源并排：搜索按来源分组，队列里混着放。',
    'sources.nas': '自建服务器', 'sources.recommended': '推荐',
    'sources.streaming': '流媒体，扫码登录',
    'sources.netease': '网易云音乐', 'sources.qq': 'QQ 音乐',
    'sources.note': '可选能力是<b>探测出来的，不是假设的</b>：服务器没有的功能，入口就不出现。流媒体只放你账号有权听的内容，会员曲目标明原因，不做任何「解析」。',
    'sandbox.1t': '脚本沙箱', 'sandbox.1b': '插件不能碰页面，也不能自己联网。',
    'sandbox.2t': '白名单代理', 'sandbox.2b': '只放行 manifest 列出的域名，重定向逐跳复查。',
    'sandbox.3t': '凭据本机加密', 'sandbox.3b': '和服务器密码同一把设备密钥，不出本机。',
    'privacy.title': '隐私，直接说清楚',
    'privacy.sub': '没有埋点，没有崩溃上报，也没有可以发过去的服务器。',
    'privacy.r1k': '你的音乐', 'privacy.r1v': '你的音乐服务器（NAS），以及你登录过的插件音源。没有别处。',
    'privacy.r2k': '历史、统计、口味画像', 'privacy.r2v': '这台设备（IndexedDB），以及你自己跑的同步服务（如果有）。',
    'privacy.r3k': '凭据', 'privacy.r3v': '用页面脚本取不出来的 AES-GCM 密钥加密落盘。',
    'privacy.r4k': '导出文件', 'privacy.r4v': '在浏览器里生成，不上传。',
    'privacy.r5v': '可选，默认关闭。后者只发歌手编号。',
    'dl.unit': '元', 'dl.title': '下载', 'dl.sub': '完全免费，完全开源。挑你的平台，几秒钟开始。',
    'dl.macarm': 'Apple 芯片', 'dl.macintel': 'Intel', 'dl.win': '安装包或 MSI',
    'dl.linux': '免安装或 DEB 包', 'dl.android': '工作流 Artifacts 下载', 'dl.ios': 'AltStore 或 Sideloadly 侧载',
    'dl.note': 'macOS 首次打开若提示「无法验证开发者」，到「系统设置」的「隐私与安全性」里允许即可；若提示「已损坏」，终端执行 <code>xattr -cr "/Applications/N1KO MUSIC.app"</code> 后再打开。不想装应用？用 Docker 跑 Web 版，一条命令。',
    'footer.type': '字体', 'footer.selfhosted': '全部自托管，不走第三方 CDN。',
    'footer.stack': '技术', 'footer.promo': '同作者',
    'footer.promo.body': '一个 key 打通 Claude、GPT、Gemini，按量计费。',
    'footer.star': '如果 N1KO MUSIC 对你有用，在 GitHub 上点一颗星，意义重大。',
  }

  var EN = {
    'nav.windows': 'Layouts', 'nav.ipad': 'iPad', 'nav.features': 'Features',
    'nav.sources': 'Sources', 'nav.download': 'Download',
    'hero.title': 'Your own library, played well',
    'hero.lede': 'Connect Navidrome, Subsonic, Jellyfin or Emby. No NAS? Sign in to NetEase Cloud Music or QQ Music with a QR code.',
    'hero.cta1': 'Download free', 'hero.cta2': 'Read the source',
    'hero.meta': 'Runs on macOS, Windows, Linux, Android, iOS and the web. Free and open source, no account, no telemetry.',
    'hero.alt': 'N1KO MUSIC on an iPad in landscape: sidebar, home page and the Now Playing panel side by side',
    'hero.caption': 'Wide windows: sidebar, page and Now Playing panel side by side. iPad in landscape and the desktop get this one.',
    'windows.title': 'The layout follows the window',
    'windows.sub': 'It reads how wide the window is, never which device it is on. iPhone, an unfolded iPhone Duo, iPad Split View and the desktop each get the layout that fits.',
    'windows.phone': 'Narrow: a tab bar at the bottom, and a mini player you swipe to skip',
    'windows.phone.alt': 'Home on iPhone: bottom tab bar and mini player',
    'windows.duo': 'iPhone Duo half folded: lyrics above the hinge, cover and play key below',
    'windows.duo.alt': 'Now Playing on a half-folded iPhone Duo: lyrics on top, covers and controls below',
    'windows.ipad': 'Medium: a side rail, for iPad in portrait and half-screen Split View',
    'windows.ipad.alt': 'An album page on iPad in portrait with the side rail',
    'player.title': 'Now Playing',
    'player.sub': 'The cover is the only large field of colour. The play button is a rubber key set in its bezel, and the lyrics sit on a faint sheet of grid paper.',
    'player.tab.player': 'Landscape', 'player.tab.dark': 'Dark', 'player.tab.login': 'Connect',
    'player.cap.player': 'A landscape window: cover and controls on the left, lyrics on the right. Tap any line to jump there.',
    'player.cap.dark': 'Dark: a warm umber night, the same terracotta one step brighter. Follows the system.',
    'player.cap.login': 'Connect: a NAS in seconds; NetEase Cloud Music and QQ Music with a scan from your phone.',
    'ipad.title': 'On iPad, it behaves like an iPad app',
    'ipad.sub': 'Attach a Magic Keyboard or a trackpad and the desktop moves come with it. Hold ⌘ for a second to see every shortcut.',
    'ipad.hold': 'hold', 'ipad.k.hold': 'Show every shortcut',
    'ipad.k.nav': 'Home, For You, Library', 'ipad.k.search': 'Search', 'ipad.k.lyrics': 'Full screen lyrics',
    'ipad.k.sidebar': 'Hide or show the sidebar', 'ipad.k.panel': 'Now Playing panel', 'ipad.k.history': 'Back, forward',
    'ipad.rightclick': 'Right click', 'ipad.k.menu': 'The song menu, same as a long press',
    'ipad.drag': 'Trackpad drag', 'ipad.k.drag': 'Drop songs into Up Next or a sidebar playlist',
    'features.title': 'What it does',
    'f.playback': 'Playback',
    'f.playback.1': 'Whole-library shuffle, sampled on the server',
    'f.playback.2': 'Lossless passthrough, or three bitrates',
    'f.playback.3': 'Similar tracks follow when the queue ends',
    'f.control': 'Control',
    'f.control.1': 'Multi-select in every list',
    'f.control.2': 'Lock screen, SMTC and MPRIS controls',
    'f.control.3': 'Car mode: huge buttons, swipe to skip',
    'f.library': 'Library',
    'f.library.1': 'Ten thousand tracks, still smooth',
    'f.library.2': 'Liner notes, bit depth, real bitrate',
    'f.library.3': 'Features appear only when your server has them',
    'f.yours': 'Your own',
    'f.yours.1': 'The Issue: your month, told in real numbers',
    'f.yours.2': 'Rediscovery and marginalia',
    'f.yours.3': 'Import and export your listening history',
    'sources.title': 'Point it at your library',
    'sources.sub': 'Both kinds side by side: search groups by source, the queue mixes freely.',
    'sources.nas': 'Your own server', 'sources.recommended': 'recommended',
    'sources.streaming': 'Streaming, QR sign-in',
    'sources.netease': 'NetEase Cloud Music', 'sources.qq': 'QQ Music',
    'sources.note': 'Optional capabilities are <b>probed, never assumed</b>: what your server lacks never appears. Streaming plays only what your own account may hear; VIP tracks say why, and nothing is “unlocked”.',
    'sandbox.1t': 'Script sandbox', 'sandbox.1b': 'Plugins get no page access and no network of their own.',
    'sandbox.2t': 'Allow-listed proxy', 'sandbox.2b': 'Only hosts in the manifest are reached; every redirect is re-checked.',
    'sandbox.3t': 'Credentials stay on the device', 'sandbox.3b': 'The same device key as server passwords; it never leaves the device.',
    'privacy.title': 'Privacy, stated plainly',
    'privacy.sub': 'No analytics, no crash reports, and no server to send them to.',
    'privacy.r1k': 'Your music', 'privacy.r1v': 'Your music server (NAS) and the plugin sources you signed in to. Nowhere else.',
    'privacy.r2k': 'History, stats, taste profile', 'privacy.r2v': 'This device (IndexedDB), plus a sync service you run yourself, if any.',
    'privacy.r3k': 'Credentials', 'privacy.r3v': 'Encrypted at rest with an AES-GCM key page scripts cannot read.',
    'privacy.r4k': 'Exported files', 'privacy.r4v': 'Generated in the browser. Never uploaded.',
    'privacy.r5v': 'Opt in, off by default. The latter sends artist ids only.',
    'dl.unit': 'dollars', 'dl.title': 'Download', 'dl.sub': 'Completely free, completely open source. Pick your platform.',
    'dl.macarm': 'Apple silicon', 'dl.macintel': 'Intel', 'dl.win': 'Installer or MSI',
    'dl.linux': 'AppImage or DEB', 'dl.android': 'From workflow artifacts', 'dl.ios': 'Sideload with AltStore or Sideloadly',
    'dl.note': 'On macOS, allow the app under System Settings, Privacy & Security on first launch; if macOS calls it damaged, run <code>xattr -cr "/Applications/N1KO MUSIC.app"</code> and open it again. Prefer no install? The web version runs in Docker with one command.',
    'footer.type': 'Type', 'footer.selfhosted': 'All self-hosted, no third-party CDN.',
    'footer.stack': 'Stack', 'footer.promo': 'Also by N1KO',
    'footer.promo.body': 'One key for Claude, GPT and Gemini, pay as you go.',
    'footer.star': 'If N1KO MUSIC is useful to you, a star on GitHub means a lot.',
  }

  var DICTS = { zh: ZH, en: EN }
  var LANG_KEY = 'n1ko-site-lang'
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
    var alts = document.querySelectorAll('[data-i18n-alt]')
    for (var j = 0; j < alts.length; j++) {
      var altKey = alts[j].getAttribute('data-i18n-alt')
      if (dict[altKey] !== undefined) alts[j].setAttribute('alt', dict[altKey])
    }
    document.documentElement.setAttribute('data-lang', currentLang)
    document.documentElement.setAttribute('lang', currentLang === 'en' ? 'en-US' : 'zh-CN')
    if (stageImg) stageImg.alt = SHOTS[currentShot].alt[currentLang === 'en' ? 1 : 0]
    try { localStorage.setItem(LANG_KEY, currentLang) } catch (e) { /* 私密模式无所谓 */ }
  }

  /* ── 「正在播放」截图切换 ── */
  var SHOTS = {
    player: { src: 'assets/player.webp', alt: ['横屏的正在播放：左边封面和控制，右边歌词', 'Now Playing in landscape: cover and controls on the left, lyrics on the right'] },
    dark:   { src: 'assets/home-dark.webp', alt: ['深色的首页', 'Home in dark mode'] },
    login:  { src: 'assets/login.webp', alt: ['连接页', 'The connect page'] },
  }
  var currentShot = 'player'
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab[data-shot]'))
  var stageImg = document.getElementById('stageImg')
  var stageCaption = document.getElementById('stageCaption')

  function selectShot(name) {
    var shot = SHOTS[name]
    if (!shot || !stageImg) return
    currentShot = name
    stageImg.classList.add('switching')
    setTimeout(function () {
      stageImg.src = shot.src
      stageImg.alt = shot.alt[currentLang === 'en' ? 1 : 0]
      stageImg.classList.remove('switching')
    }, 180)
    if (stageCaption) {
      var key = 'player.cap.' + name
      stageCaption.setAttribute('data-i18n', key)
      stageCaption.innerHTML = t(key)
    }
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-shot') === name
      tabs[i].classList.toggle('is-on', on)
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false')
      tabs[i].tabIndex = on ? 0 : -1
    }
  }

  for (var tb = 0; tb < tabs.length; tb++) {
    ;(function (tab) {
      tab.addEventListener('click', function () { selectShot(tab.getAttribute('data-shot')) })
    })(tabs[tb])
  }

  /* tablist 支持左右键（WAI-ARIA tabs 模式的最小实现） */
  var tablist = document.querySelector('.tabs')
  if (tablist) {
    tablist.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      var idx = tabs.findIndex(function (tab) { return tab.classList.contains('is-on') })
      var next = (idx + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
      tabs[next].focus()
      selectShot(tabs[next].getAttribute('data-shot'))
    })
  }
  for (var k = 0; k < tabs.length; k++) tabs[k].tabIndex = tabs[k].classList.contains('is-on') ? 0 : -1

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
})()
