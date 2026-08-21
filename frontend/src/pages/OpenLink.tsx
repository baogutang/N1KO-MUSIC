/**
 * `/open?url=…` —— 深链接在浏览器里的落点。
 *
 * 浏览器不给纯 Web 应用注册 `n1ko://`，能注册的是 `web+n1ko://`（PWA 的
 * protocol_handlers，见 vite.config.ts），系统会把它转成访问这个路径。
 * 解析仍然走 services/deepLink.ts 那一套，桌面壳和这里不会各长一套规则。
 *
 * 这一页只是个中转：解析成功立刻 replace 走，不在历史里留下一格。
 */

import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { parseDeepLink, runDeepLinkCommand, DEEP_LINK_SCHEME } from '@/services/deepLink'

export default function OpenLinkPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    const raw = params.get('url') ?? ''
    // protocol_handlers 送来的是 web+n1ko://…，换回内部统一的 scheme 再解析
    const normalized = raw.replace(/^web\+n1ko:/i, `${DEEP_LINK_SCHEME}:`)
    const action = parseDeepLink(normalized)

    if (!action) {
      setFailed(raw)
      return
    }
    if (action.command) void runDeepLinkCommand(action.command)
    // replace：中转页不该占住一格历史，否则返回键会把人送回这里
    navigate(action.route ?? '/', { replace: true })
  }, [params, navigate])

  if (!failed) {
    return (
      <p className="py-24 text-center font-serif text-[15px] text-ink-faint">正在打开…</p>
    )
  }

  return (
    <div className="py-24 text-center">
      <p className="font-serif text-xl font-semibold">这条链接看不懂。</p>
      <p className="mt-2 break-all text-sm text-ink-faint">{failed}</p>
      <button
        onClick={() => navigate('/', { replace: true })}
        className="mt-6 text-sm font-semibold underline decoration-hair decoration-1 underline-offset-[6px] transition-colors hover:text-primary hover:decoration-primary"
      >
        回到首页
      </button>
    </div>
  )
}
