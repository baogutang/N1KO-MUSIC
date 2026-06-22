import { Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useThemeStore } from './store/themeStore'
import { useServerStore } from './store/serverStore'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { PremiumRoute } from './components/auth/PremiumRoute'
import { Loader2 } from 'lucide-react'
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
      <Loader2 className="w-5 h-5 animate-spin" />
      <span className="text-sm">加载中...</span>
    </div>
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
                  <PremiumRoute path="/recommendations">
                    <RecommendationsPage />
                  </PremiumRoute>
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
                  <PremiumRoute path="/favorites">
                    <FavoritesPage />
                  </PremiumRoute>
                }
              />
              <Route path="history" element={<HistoryPage />} />
              <Route
                path="stats"
                element={
                  <PremiumRoute path="/stats">
                    <StatsPage />
                  </PremiumRoute>
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
