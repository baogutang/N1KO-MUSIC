import { Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useThemeStore } from './store/themeStore'
import { useServerStore } from './store/serverStore'
import { useMemberStore } from './store/memberStore'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { MemberUpgradeDialog } from './components/member/MemberUpgradeDialog'
import { CircleNotch } from '@phosphor-icons/react'
import {
  MainLayoutPage,
  LoginPage,
  HomePage,
  SearchPage,
  LibraryPage,
  AlbumsPage,
  AlbumDetailPage,
  ArtistsPage,
  ArtistDetailPage,
  PlaylistsPage,
  PlaylistDetailPage,
  FavoritesPage,
  HistoryPage,
  StatsPage,
  SettingsPage,
  RecommendationsPage,
  SongDetailPage,
} from './routes/lazyRoutes'

function RouteLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground gap-2">
      <CircleNotch className="w-5 h-5 animate-spin" />
      <span className="text-sm">加载中...</span>
    </div>
  )
}

const PREMIUM_FEATURE_LABELS: Record<string, string> = {
  '/recommendations': '为你推荐',
  '/favorites': '我的收藏',
  '/stats': '听歌统计',
}

/**
 * 会员路由守卫：非会员先展示升级弹窗，关闭弹窗后再跳回首页。
 * 注意不能与 <Navigate> 同时渲染——Navigate 挂载即跳转，会在弹窗出现前卸载整棵子树。
 */
function PremiumGate({ path, children }: { path: string; children: React.ReactNode }) {
  const isPremium = useMemberStore(s => s.isPremium)
  const [dismissed, setDismissed] = useState(false)

  if (isPremium) return <>{children}</>
  if (dismissed) return <Navigate to="/" replace />

  return (
    <MemberUpgradeDialog
      open
      onOpenChange={open => { if (!open) setDismissed(true) }}
      featureName={PREMIUM_FEATURE_LABELS[path]}
    />
  )
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { activeServerId, servers } = useServerStore()
  const isAuthenticated = activeServerId && servers.some(s => s.id === activeServerId)
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

export default function App() {
  const { resolvedTheme } = useThemeStore()

  useEffect(() => {
    const root = document.documentElement
    if (resolvedTheme === 'light') {
      root.classList.add('light')
      root.classList.remove('dark')
    } else {
      root.classList.remove('light')
      root.classList.add('dark')
    }
  }, [resolvedTheme])

  return (
    <ErrorBoundary>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Suspense fallback={<RouteLoading />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <MainLayoutPage />
                </RequireAuth>
              }
            >
              <Route index element={<HomePage />} />
              <Route path="search" element={<SearchPage />} />
              <Route path="library" element={<LibraryPage />} />
              <Route
                path="recommendations"
                element={
                  <PremiumGate path="/recommendations">
                    <RecommendationsPage />
                  </PremiumGate>
                }
              />
              <Route path="albums" element={<AlbumsPage />} />
              <Route path="albums/:id" element={<AlbumDetailPage />} />
              <Route path="artists" element={<ArtistsPage />} />
              <Route path="artists/:id" element={<ArtistDetailPage />} />
              <Route path="playlists" element={<PlaylistsPage />} />
              <Route path="playlists/:id" element={<PlaylistDetailPage />} />
              <Route
                path="favorites"
                element={
                  <PremiumGate path="/favorites">
                    <FavoritesPage />
                  </PremiumGate>
                }
              />
              <Route path="history" element={<HistoryPage />} />
              <Route
                path="stats"
                element={
                  <PremiumGate path="/stats">
                    <StatsPage />
                  </PremiumGate>
                }
              />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="songs/:id" element={<SongDetailPage />} />
              <Route path="songs/detail" element={<Navigate to="/library" replace />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
