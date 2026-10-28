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
import { LoadingState } from '@/components/common/EmptyState'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'

export default function OpenLinkPage() {
  const { t } = useT()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    const raw = params.get('url') ?? ''
    // protocol_handlers 送来的是 web+niko://…，换回内部统一的 scheme 再解析
    const normalized = raw.replace(/^web\+niko:/i, `${DEEP_LINK_SCHEME}:`)
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
      <div className="mx-auto mt-10 max-w-[560px]">
        <LoadingState label={t('empty.opening')} />
      </div>
    )
  }

  /* 解析失败：一块面板上的一句话 + 收到的原始地址 + 回首页（主操作） */
  return (
    <div className="sheet mx-auto mt-10 max-w-[560px] px-6 py-14 text-center">
      <h1 className="font-display text-[34px] font-bold leading-[1.05] tracking-[-0.03em] text-ink">
        {t('empty.deepLink.title')}
      </h1>
      <p className="mx-auto mt-3 max-w-[34em] break-all text-[14px] text-ink-3">{failed}</p>
      <Button type="button" className="mt-7" onClick={() => navigate('/', { replace: true })}>
        {t('action.backHome')}
      </Button>
    </div>
  )
}
