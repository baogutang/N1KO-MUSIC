/**
 * 添加流媒体音源前的声明确认（PLAN 1.6 / PROTOCOL §2 disclaimer）。
 * 复选框 + 继续：声明必须明确被确认，不预勾选。
 */

import { useState } from 'react'
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
    <div className="space-y-5 border-t border-hair pt-7">
      <div className="flex items-center gap-2.5">
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 text-[12.5px] tracking-[0.08em] text-ink-soft hover:text-primary transition-colors"
        >
          {t('action.back')}
        </button>
        <span className="text-ink-faint">·</span>
        <span className="font-serif text-[14px] font-semibold text-foreground">
          {pluginName}
        </span>
      </div>

      <div className="border-l-2 border-primary/70 bg-paper-deep/40 px-4 py-3.5">
        <p className="mb-1.5 text-[11px] tracking-[0.18em] text-ink-faint">
          {t('sources.disclaimer.tag')}
        </p>
        <p className="text-[13px] leading-relaxed text-ink-soft whitespace-pre-line">
          {disclaimer}
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-relaxed text-ink-soft">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => setChecked(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 accent-[var(--primary)]"
        />
        {t('sources.disclaimer.acknowledge')}
      </label>

      <div className="pt-2 text-center">
        <Button onClick={onConfirm} disabled={!checked}>
          {t('sources.disclaimer.continue')}
        </Button>
      </div>
    </div>
  )
}
