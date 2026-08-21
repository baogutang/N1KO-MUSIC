import { Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useThemeStore } from './store/themeStore'
import { useServerStore } from './store/serverStore'
import { useT } from '@/i18n'
import { ErrorBoundary } from './components/common/ErrorBoundary'
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
  IssuePage,
  OpenLinkPage,
  SettingsPage,
  RecommendationsPage,
  SongDetailPage,
} from './routes/lazyRoutes'

function RouteLoading() {
  const { t } = useT()
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground gap-2">
      <CircleNotch className="w-5 h-5 animate-spin" />
      <span className="text-sm">{t('empty.loading')}</span>
    </div>
  )
}

/**
 * 凭据是加密存放的，解密只有异步接口，所以 rehydrate 完成前
 * activeServerId 一定是 null。这时候判断「有没有登录」会把已登录的用户
 * 一脚踢到登录页，刷新一次就掉线一次。先等它 hydrate 完。
 */
function useServerStoreHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useServerStore.persist.hasHydrated())
  useEffect(() => {
    if (hydrated) return
    const unsubscribe = useServerStore.persist.onFinishHydration(() => setHydrated(true))
    /**
     * 订阅之后再补检一次。
     *
     * 今天 main.tsx 的 Bootstrap 已经在渲染 App 之前等过 hydration，走不到这里；
     * 但只要那道闸被移走、或者有人后来调了 persist.rehydrate()，
     * 「事件在订阅之前就发完了」就会变成永远停在加载态。补这一行的代价是零。
     */
    if (useServerStore.persist.hasHydrated()) setHydrated(true)
    return unsubscribe
  }, [hydrated])
  return hydrated
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const hydrated = useServerStoreHydrated()
  const { activeServerId, servers } = useServerStore()
  if (!hydrated) return <RouteLoading />
  const isAuthenticated = activeServerId && servers.some(s => s.id === activeServerId)
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

export default function App() {
  const { resolvedTheme } = useThemeStore()

  useEffect(() => {
    // 浅色为默认（无 class），深色为 'dark' class
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark')
  }, [resolvedTheme])

  return (
    <ErrorBoundary>
      {/* v7 起 startTransition 与 relativeSplatPath 已是默认行为，future 开关随之移除 */}
      <BrowserRouter>
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
              <Route path="recommendations" element={<RecommendationsPage />} />
              <Route path="albums" element={<AlbumsPage />} />
              <Route path="albums/:id" element={<AlbumDetailPage />} />
              <Route path="artists" element={<ArtistsPage />} />
              <Route path="artists/:id" element={<ArtistDetailPage />} />
              <Route path="playlists" element={<PlaylistsPage />} />
              <Route path="playlists/:id" element={<PlaylistDetailPage />} />
              <Route path="favorites" element={<FavoritesPage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="stats" element={<StatsPage />} />
              <Route path="issue" element={<IssuePage />} />
              {/* 深链接落点：web+n1ko:// 由 PWA 转成这个路径 */}
              <Route path="open" element={<OpenLinkPage />} />
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
