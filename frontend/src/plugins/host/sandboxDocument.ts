/**
 * 沙箱 iframe 的 blob: 文档（PROTOCOL §8）。
 *
 * 固定内容 + 自带 CSP：default-src 'none' 兜底，script 只允许宿主源与 blob:
 * （宿主源加载 plugin-sandbox.js，blob: 加载插件代码），connect/img/style/frame
 * 全部关死——插件在文档层就没有直连网络的通道。
 */

export function createSandboxDocumentUrl(origin: string): string {
  const csp = [
    "default-src 'none'",
    `script-src ${origin} blob:`,
    "connect-src 'none'",
    "img-src 'none'",
    "style-src 'none'",
    "frame-src 'none'",
  ].join('; ')

  // charset 必须显式声明（MIME 参数 + meta 双保险）：opaque-origin 的 blob
  // 文档不继承父页编码，会回落到 windows-1252，连带把无 charset 的插件脚本
  // 一起错误解码，中文歌词名全部变成 mojibake
  const html = `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<script src="${origin}/plugin-sandbox.js"></script>`

  return URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
}
