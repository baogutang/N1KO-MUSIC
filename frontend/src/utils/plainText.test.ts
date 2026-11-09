/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import { htmlToPlainText } from './plainText'

describe('htmlToPlainText', () => {
  it('纯文本原样返回（首尾空白去掉）', () => {
    expect(htmlToPlainText('  一句话。 ')).toBe('一句话。')
    expect(htmlToPlainText(undefined)).toBe('')
  })

  it('去标签、解码实体', () => {
    expect(htmlToPlainText('a <b>bold</b> &amp; &quot;q&quot; &lt;3')).toBe('a bold & "q" <3')
  })

  it('去掉 Last.fm 的「Read more」链接，不留尾随空格', () => {
    const html = 'Foo is a band. <a target=\'_blank\' rel="nofollow" href="https://www.last.fm/music/Foo">Read more on Last.fm</a>'
    expect(htmlToPlainText(html)).toBe('Foo is a band.')
  })

  it('去掉作为纯文本留在末尾的「Read more on Last.fm」', () => {
    expect(htmlToPlainText('Foo is a band. Read more on Last.fm')).toBe('Foo is a band.')
    expect(htmlToPlainText('Foo is a band. Read more on Last.fm.')).toBe('Foo is a band.')
  })

  it('其余链接保留文字、丢掉地址', () => {
    expect(htmlToPlainText('see <a href="https://x.test/a">Foo Fighters</a> too')).toBe('see Foo Fighters too')
  })

  it('<br> 与段落变成换行，连续空行折成一个', () => {
    expect(htmlToPlainText('one<br>two<br/><br>three<p>four</p>five')).toBe('one\ntwo\nthree\nfour\nfive')
    expect(htmlToPlainText('one\r\n\r\n\r\ntwo')).toBe('one\ntwo')
  })

  it('script / style 的内容不当正文', () => {
    expect(htmlToPlainText('hi<script>alert(1)</script><style>p{}</style>there')).toBe('hithere')
  })

  it('不会执行 / 加载任何东西（img onerror 之类只是被丢掉）', () => {
    const w = window as unknown as { __pwned?: boolean }
    htmlToPlainText('<img src=x onerror="window.__pwned=true">ok')
    expect(w.__pwned).toBeUndefined()
    expect(htmlToPlainText('<img src=x onerror="window.__pwned=true">ok')).toBe('ok')
  })
})
