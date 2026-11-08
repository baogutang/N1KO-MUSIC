// 系统 WebView 太旧时的提示（电视盒子上最常见：不少盒子的 WebView 停在很多年前的版本）。
//
// 整套配色用 oklch() 写成（src/index.css），Chrome 111 之前的内核不认识它：界面不会坏、照样能用，
// 但会变成白底黑字、按钮没有底色。这里不去补一整套旧格式的颜色（token 是在运行时按封面色相拼出来的，
// 补不全），而是告诉用户升级系统 WebView——升级之后一切照常。
//
// 和 theme-preflash.js 一样是外部文件：不让 Tauri 的 CSP 为它开 'unsafe-inline'。
// 颜色只能写十六进制：走到这里的内核本来就不认 oklch。
(function () {
  try {
    if (window.CSS && CSS.supports && CSS.supports('color', 'oklch(0% 0 0)')) return
    if (sessionStorage.getItem('n1ko-webview-notice') === '1') return
  } catch (e) {}
  var match = /Chrome\/(\d+)/.exec(navigator.userAgent)
  var version = match ? match[1] : '?'
  var zh = /^zh/i.test(navigator.language || '')
  var text = zh
    ? '系统 WebView 版本过旧（Chrome ' + version + '），界面颜色显示不出来。请在应用商店里更新「Android System WebView」，再重新打开 N1KO MUSIC。'
    : 'Android System WebView is too old (Chrome ' + version + ') to show N1KO MUSIC’s colours. Update “Android System WebView” from the app store, then reopen the app.'

  function show() {
    var box = document.createElement('div')
    // role=dialog + data-state=open：电视的方向键导航（src/lib/spatialNav.ts）把它当成最上面一层，焦点不会跑到底下去
    box.setAttribute('role', 'dialog')
    box.setAttribute('data-state', 'open')
    box.setAttribute('aria-modal', 'true')
    box.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(10,12,15,0.86);font-family:sans-serif'
    var card = document.createElement('div')
    card.style.cssText = 'max-width:520px;padding:24px 28px;border-radius:20px;background:#1b1f25;color:#f2f4f7;font-size:16px;line-height:1.55;box-shadow:0 20px 60px rgba(0,0,0,0.5)'
    var p = document.createElement('p')
    p.style.cssText = 'margin:0 0 18px'
    p.textContent = text
    var button = document.createElement('button')
    button.type = 'button'
    button.textContent = zh ? '知道了' : 'OK'
    button.style.cssText = 'height:44px;padding:0 24px;border:0;border-radius:999px;background:#c8ef3c;color:#1d3311;font-size:15px;font-weight:600;outline:3px solid #f2f4f7;outline-offset:3px'
    button.addEventListener('click', function () {
      try { sessionStorage.setItem('n1ko-webview-notice', '1') } catch (e) {}
      box.parentNode && box.parentNode.removeChild(box)
    })
    card.appendChild(p)
    card.appendChild(button)
    box.appendChild(card)
    document.body.appendChild(box)
    button.focus()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show)
  else show()
})()
