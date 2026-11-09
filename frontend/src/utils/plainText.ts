/**
 * 服务端给的简介 → 纯文本。
 *
 * Subsonic / Navidrome 的 biography 是 Last.fm 的原文，常带 HTML：
 * `……<a target='_blank' href="https://www.last.fm/music/X">Read more on Last.fm</a>`，
 * 还有 `&quot;` 这类实体。直接当文本渲染，标签和实体都原样露在页面上。
 *
 * 用 DOMParser 解析而不是正则硬剥：它按浏览器自己的规则处理残缺标签和实体，
 * 解析出的文档是惰性的（不执行脚本、不加载图片），我们只取 textContent，
 * 所以不需要也不使用 dangerouslySetInnerHTML。
 */

/** 块级换行：<br> 与段落边界变成 \n（textContent 本身会把它们吞掉） */
function withBlockBreaks(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p(\s[^>]*)?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
}

export function htmlToPlainText(input: string | null | undefined): string {
  if (!input) return ''
  let text: string
  if (typeof DOMParser === 'undefined') {
    // 没有 DOM（非浏览器环境）时退而求其次：只剥标签，不解码实体
    text = withBlockBreaks(input).replace(/<[^>]*>/g, '')
  } else {
    const doc = new DOMParser().parseFromString(withBlockBreaks(input), 'text/html')
    // 脚本与样式的内容不是正文
    doc.querySelectorAll('script, style').forEach(el => el.remove())
    // Last.fm 的「Read more on Last.fm」是个外链，去掉链接后留着文字也就没有意义了
    doc.querySelectorAll('a').forEach(a => {
      if (/^\s*read more/i.test(a.textContent ?? '')) a.remove()
    })
    text = doc.body.textContent ?? ''
  }
  return text
    .replace(/\r\n?/g, '\n')
    // 链接被摘掉后可能留下纯文本形态的同一句尾巴
    .replace(/\s*read more on last\.fm\.?\s*$/i, '')
    // 换行两侧的空白（含不换行空格）去掉：[^\S\n] = 除换行外的任意空白
    .replace(/[^\S\n]*\n[^\S\n]*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}
