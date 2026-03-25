import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useThemeStore } from './store/themeStore'
import { useServerStore } from './store/serverStore'
import MainLayout from './components/layout/MainLayout'
import Login from './pages/Login'
import Home from './pages/Home'
import Search from './pages/Search'
import Library from './pages/Library'
import Albums from './pages/Albums'
import AlbumDetail from './pages/AlbumDetail'
import Artists from './pages/Artists'
import ArtistDetail from './pages/ArtistDetail'
import Playlists from './pages/Playlists'
import PlaylistDetail from './pages/PlaylistDetail'
import Favorites from './pages/Favorites'
import History from './pages/History'
import Stats from './pages/Stats'
import Settings from './pages/Settings'
import Recommendations from './pages/Recommendations'
import SongDetail from './pages/SongDetail'
import { Toaster } from './components/ui/toaster'
import { TooltipProvider } from './components/ui/tooltip'

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
    <TooltipProvider>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <MainLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Home />} />
          <Route path="search" element={<Search />} />
          <Route path="library" element={<Library />} />
          <Route path="recommendations" element={<Recommendations />} />
          <Route path="albums" element={<Albums />} />
          <Route path="albums/:id" element={<AlbumDetail />} />
          <Route path="artists" element={<Artists />} />
          <Route path="artists/:id" element={<ArtistDetail />} />
          <Route path="playlists" element={<Playlists />} />
          <Route path="playlists/:id" element={<PlaylistDetail />} />
          <Route path="favorites" element={<Favorites />} />
          <Route path="history" element={<History />} />
          <Route path="stats" element={<Stats />} />
          <Route path="settings" element={<Settings />} />
          <Route path="songs/detail" element={<SongDetail />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
    </TooltipProvider>
  )
}
