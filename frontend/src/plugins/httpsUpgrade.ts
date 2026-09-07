/**
 * 插件返回的地址一律升到 https。
 *
 * 桌面壳的页面是 `tauri://localhost`、移动壳是 `capacitor://localhost`，都是
 * **安全上下文**——`http://` 的图片与音频会被当混合内容直接拦掉，表现是封面
 * 全变成裂图、点播放没声音，控制台之外没有任何线索。而网易云返回的封面就是
 * `http://p1.music.126.net/...`，QQ 的 CDN 派发也可能给 http。
 *
 * 开发态页面本身是 http，所以这个坑只在装好的 App 里出现——又一处「开发态验过
 * 不等于壳里验过」。这些 CDN 都支持 https（实测过），升级是纯收益：真不支持
 * https 的主机在壳里本来也加载不了。
 */
export function upgradeInsecureUrl(url: string): string {
  if (!url.startsWith('http://')) return url
  return 'https://' + url.slice('http://'.length)
}
