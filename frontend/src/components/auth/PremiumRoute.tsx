import { Navigate } from 'react-router-dom'
import { useMemberStore } from '@/store/memberStore'
import { MemberUpgradeDialog } from '@/components/member/MemberUpgradeDialog'
import { useState, useEffect } from 'react'

const FEATURE_LABELS: Record<string, string> = {
  '/recommendations': '为你推荐',
  '/favorites': '我的收藏',
  '/stats': '听歌统计',
}

export function PremiumRoute({
  path,
  children,
}: {
  path: keyof typeof FEATURE_LABELS
  children: React.ReactNode
}) {
  const isPremium = useMemberStore(s => s.isPremium)
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  useEffect(() => {
    if (!isPremium) setUpgradeOpen(true)
  }, [isPremium])

  if (isPremium) return <>{children}</>

  return (
    <>
      <MemberUpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        featureName={FEATURE_LABELS[path]}
      />
      <Navigate to="/" replace />
    </>
  )
}
