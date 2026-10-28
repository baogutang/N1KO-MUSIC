import { CheckCircle, WarningCircle } from '@phosphor-icons/react'
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from './toast'
import { useToast } from './use-toast'

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        // 结果用图标说，不用侧边色条：成功是叶绿的勾，出错是玫瑰色的叹号
        const Icon = props.variant === 'destructive' ? WarningCircle : props.variant === 'success' ? CheckCircle : null
        return (
          <Toast key={id} {...props}>
            {Icon && (
              <Icon
                aria-hidden="true"
                weight="fill"
                className={props.variant === 'destructive' ? 'h-5 w-5 text-danger' : 'h-5 w-5 text-leaf'}
              />
            )}
            <div className="grid min-w-0 flex-1 gap-0.5">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
