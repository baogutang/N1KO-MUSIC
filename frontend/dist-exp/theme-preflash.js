// 启动防白闪：在 bundle 加载前按持久化主题预置 dark class 与底色（与 index.css --paper 一致）。
//
// 这段刻意是一个外部文件而不是内联脚本：内联脚本会迫使 Tauri 的 CSP 保留
// script-src 'unsafe-inline'，而它是整条策略里最值钱的一项限制。
// 同源小文件在 <head> 里同样会在首次绘制前执行，防白闪效果不变。
try {
  var s = JSON.parse(localStorage.getItem('msp-theme-store') || '{}')
  var t = s && s.state && s.state.theme
  var d = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', d)
  document.documentElement.style.background = d ? '#1a1712' : '#f4efe3'
} catch (e) {}
