import { lazy } from 'react'

type Loader = () => Promise<unknown>

const loaders = {
  mainLayout: () => import('../components/layout/MainLayout'),
  login: () => import('../pages/Login'),
  home: () => import('../pages/Home'),
  search: () => import('../pages/Search'),
  library: () => import('../pages/Library'),
  albums: () => import('../pages/Albums'),
  albumDetail: () => import('../pages/AlbumDetail'),
  artists: () => import('../pages/Artists'),
  artistDetail: () => import('../pages/ArtistDetail'),
  playlists: () => import('../pages/Playlists'),
  playlistDetail: () => import('../pages/PlaylistDetail'),
  favorites: () => import('../pages/Favorites'),
  history: () => import('../pages/History'),
  stats: () => import('../pages/Stats'),
  settings: () => import('../pages/Settings'),
  recommendations: () => import('../pages/Recommendations'),
  songDetail: () => import('../pages/SongDetail'),
  fullscreenPlayer: () => import('../components/player/FullscreenPlayer'),
}

export const MainLayoutPage = lazy(loaders.mainLayout)
export const LoginPage = lazy(loaders.login)
export const HomePage = lazy(loaders.home)
export const SearchPage = lazy(loaders.search)
export const LibraryPage = lazy(loaders.library)
export const AlbumsPage = lazy(loaders.albums)
export const AlbumDetailPage = lazy(loaders.albumDetail)
export const ArtistsPage = lazy(loaders.artists)
export const ArtistDetailPage = lazy(loaders.artistDetail)
export const PlaylistsPage = lazy(loaders.playlists)
export const PlaylistDetailPage = lazy(loaders.playlistDetail)
export const FavoritesPage = lazy(loaders.favorites)
export const HistoryPage = lazy(loaders.history)
export const StatsPage = lazy(loaders.stats)
export const SettingsPage = lazy(loaders.settings)
export const RecommendationsPage = lazy(loaders.recommendations)
export const SongDetailPage = lazy(loaders.songDetail)

const prefetched = new Set<string>()
function prefetchOnce(key: string, loader: Loader) {
  if (prefetched.has(key)) return
  prefetched.add(key)
  void loader()
}

function normalizePath(path: string): string {
  const clean = path.split('?')[0].split('#')[0]
  return clean.endsWith('/') && clean !== '/' ? clean.slice(0, -1) : clean
}

const routeMatchers: Array<{ test: (path: string) => boolean; key: string; loader: Loader }> = [
  { test: p => p === '/', key: 'route:home', loader: loaders.home },
  { test: p => p === '/search', key: 'route:search', loader: loaders.search },
  { test: p => p === '/library', key: 'route:library', loader: loaders.library },
  { test: p => p === '/recommendations', key: 'route:recommendations', loader: loaders.recommendations },
  { test: p => p === '/albums', key: 'route:albums', loader: loaders.albums },
  { test: p => /^\/albums\/[^/]+$/.test(p), key: 'route:album-detail', loader: loaders.albumDetail },
  { test: p => p === '/artists', key: 'route:artists', loader: loaders.artists },
  { test: p => /^\/artists\/[^/]+$/.test(p), key: 'route:artist-detail', loader: loaders.artistDetail },
  { test: p => p === '/playlists', key: 'route:playlists', loader: loaders.playlists },
  { test: p => /^\/playlists\/[^/]+$/.test(p), key: 'route:playlist-detail', loader: loaders.playlistDetail },
  { test: p => p === '/favorites', key: 'route:favorites', loader: loaders.favorites },
  { test: p => p === '/history', key: 'route:history', loader: loaders.history },
  { test: p => p === '/stats', key: 'route:stats', loader: loaders.stats },
  { test: p => p === '/settings', key: 'route:settings', loader: loaders.settings },
  { test: p => p === '/songs/detail', key: 'route:song-detail', loader: loaders.songDetail },
]

export function prefetchRoute(path: string) {
  const normalized = normalizePath(path)
  const match = routeMatchers.find(m => m.test(normalized))
  if (!match) return
  prefetchOnce(match.key, match.loader)
}

export function prefetchCommonAuthenticatedRoutes() {
  prefetchRoute('/search')
  prefetchRoute('/library')
  prefetchRoute('/albums')
  prefetchRoute('/playlists')
}

export function prefetchFullscreenPlayer() {
  prefetchOnce('chunk:fullscreen-player', loaders.fullscreenPlayer)
}
