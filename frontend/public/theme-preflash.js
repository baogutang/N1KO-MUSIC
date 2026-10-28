// 启动防白闪：在 bundle 加载前按持久化的明暗预置 <html> 的 dark class、
// data-theme 与首屏底色（与 index.css 的 --ground 一致）。
//
// 这段刻意是一个外部文件而不是内联脚本：内联脚本会迫使 Tauri 的 CSP 保留
// script-src 'unsafe-inline'，而它是整条策略里最值钱的一项限制。
// 同源小文件在 <head> 里同样会在首次绘制前执行，防白闪效果不变。
//
// 底色与 themeStore.ts 的 THEME_BACKGROUNDS 是同一份数据的两处副本：
// 这里不能 import（模块脚本会推迟到 DOM 解析后执行，白闪就回来了）。改色时两处都要动。
(function () {
  var BG = { light: '#f8fafc', dark: '#101317' }
  try {
    var s = JSON.parse(localStorage.getItem('msp-theme-store') || '{}')
    var st = (s && s.state) || {}
    var d = st.theme === 'dark' || (st.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', d)
    document.documentElement.setAttribute('data-theme', d ? 'dark' : 'light')
    document.documentElement.style.background = BG[d ? 'dark' : 'light']
  } catch (e) {}
})()
