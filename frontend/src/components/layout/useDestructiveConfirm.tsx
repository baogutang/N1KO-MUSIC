/**
 * 报头菜单的破坏性动作确认（阶段 1.7）：
 * 切主库会清空队列与缓存、断开连接会让曲库页「无可浏览」——
 * 设置页对同样动作有确认框，报头原先点一下就执行。
 * 这里抽出共用 hook：组件挂一个 state + 一段 Dialog，动作先挂起。
 */
import { useState } from 'react'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'

export interface DestructiveConfirmSpec {
  title: string
  description?: string
  /** 确认键文案；缺省用通用「确认」词条 */
  confirmLabel?: string
  onConfirm: () => void
}

export function useDestructiveConfirm() {
  const [pending, setPending] = useState<DestructiveConfirmSpec | null>(null)
  return {
    /** 请求执行一个破坏性动作：弹确认框，确认后才跑 */
    request(spec: DestructiveConfirmSpec) {
      setPending(spec)
    },
    dialog: (
      <DestructiveConfirmDialog spec={pending} onClose={() => setPending(null)} />
    ),
  }
}

function DestructiveConfirmDialog({ spec, onClose }: { spec: DestructiveConfirmSpec | null; onClose: () => void }) {
  const { t } = useT()
  return (
    <Dialog open={spec !== null} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{spec?.title ?? ''}</DialogTitle>
          {spec?.description && <DialogDescription>{spec.description}</DialogDescription>}
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button
            onClick={() => {
              onClose()
              spec?.onConfirm()
            }}
          >
            {spec?.confirmLabel ?? t('settings.disconnect.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
