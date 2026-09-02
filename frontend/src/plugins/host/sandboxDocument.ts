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

  const html = `<!doctype html>
<meta http-equiv="Content-Security-Policy" content="${csp}">
<script src="${origin}/plugin-sandbox.js"></script>`

  return URL.createObjectURL(new Blob([html], { type: 'text/html' }))
}
