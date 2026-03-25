import { Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useThemeStore } from './store/themeStore'
import { useServerStore } from './store/serverStore'
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
  return <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground" />
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
            <Route path="settings" element={<SettingsPage />} />
            <Route path="songs/detail" element={<SongDetailPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
