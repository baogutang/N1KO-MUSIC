/**
 * 阶段 3.2 回归：离线曲库缓存按查询自己的源打标。
 *
 * 用户真实路径：连着 NAS（主库）+ 网易云，网易云的收藏列表在离线时摆得出来；
 * 把主库切到 QQ 再切回来，网易云与 NAS 的离线内容都还在——只有删源才清。
 */
import { describe, expect, it } from 'vitest'
import { ownerOf } from '@/hooks/useOfflineLibraryCache'

describe('ownerOf（阶段 3.2：打标用查询自己的源）', () => {
  it('单源页面的键头（serverKey 形态）剥掉 @库范围 后打标', () => {
    expect(ownerOf(['nas@folder-1', 'albums'], 'nas')).toBe('nas')
    expect(ownerOf(['nas', 'starred'], 'nas')).toBe('nas')
  })

  it('聚合查询的裸 serverId 键头：不跟主库走', () => {
    // 主库是 nas，但这条查询属于 wy——打标必须是 wy
    expect(ownerOf(['wy', 'starred'], 'nas')).toBe('wy')
  })

  it('键头不是字符串（旧形态/异常）时回落主库', () => {
    expect(ownerOf([undefined, 'albums'], 'nas')).toBe('nas')
    expect(ownerOf([123, 'albums'], 'nas')).toBe('nas')
    expect(ownerOf([undefined, 'albums'], null)).toBe('no-server')
  })
})
