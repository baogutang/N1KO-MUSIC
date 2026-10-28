/**
 * 添加流媒体音源前的声明确认（PLAN 1.6 / PROTOCOL §2 disclaimer）。
 * 复选框 + 继续：声明必须明确被确认，不预勾选。
 */

import { useState } from 'react'
import { ArrowLeft } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'

export function PluginDisclaimer({
  pluginName,
  disclaimer,
  onConfirm,
  onCancel,
}: {
  pluginName: string
  disclaimer: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useT()
  const [checked, setChecked] = useState(false)

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-x-3">
        <button
          onClick={onCancel}
          className="press-pop -ml-3 inline-flex min-h-11 items-center gap-1.5 rounded-pill px-3 text-[14px] font-semibold text-ink-2 hover:bg-ink/[0.05] hover:text-ink"
        >
          <ArrowLeft size={15} />
          {t('action.back')}
        </button>
        <span className="min-w-0 truncate font-display text-[17px] font-semibold text-ink">
          {pluginName}
        </span>
      </div>

      <div className="rounded-lg bg-surface-2 p-4">
        <p className="mb-1.5 text-[15px] font-semibold text-ink">
          {t('sources.disclaimer.title')}
        </p>
        <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink-2">
          {disclaimer}
        </p>
      </div>

      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[14px] leading-relaxed text-ink-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => setChecked(e.target.checked)}
          className="mt-0.5 h-5 w-5 flex-shrink-0 accent-leaf"
        />
        {t('sources.disclaimer.acknowledge')}
      </label>

      <Button size="lg" className="w-full" onClick={onConfirm} disabled={!checked}>
        {t('sources.disclaimer.continue')}
      </Button>
    </div>
  )
}
