import { describe, it, expectTypeOf } from 'vitest'
import type {
  MapMode,
  GlobalPointFeatureProperties,
  ThumbnailLoadState,
  ClusterFeatureProperties,
} from '@/components/map/types'

describe('Map Global Types', () => {
  it('MapMode should be a union of complete and simple', () => {
    expectTypeOf<MapMode>().toEqualTypeOf<'complete' | 'simple'>()
  })

  it('GlobalPointFeatureProperties should extend base properties with bangumiId and imageUrl', () => {
    const globalProps: GlobalPointFeatureProperties = {
      pointId: 'test-123',
      color: '#ff0000',
      selected: 0,
      userState: 'visited',
      bangumiId: 12345,
      imageUrl: 'https://example.com/image.jpg',
    }

    expectTypeOf(globalProps).toMatchTypeOf<GlobalPointFeatureProperties>()
    expectTypeOf(globalProps.pointId).toEqualTypeOf<string>()
    expectTypeOf(globalProps.color).toEqualTypeOf<string>()
    expectTypeOf(globalProps.selected).toEqualTypeOf<number>()
    expectTypeOf(globalProps.userState).toEqualTypeOf<string>()
    expectTypeOf(globalProps.bangumiId).toEqualTypeOf<number>()
    expectTypeOf(globalProps.imageUrl).toEqualTypeOf<string | null>()
  })

  it('GlobalPointFeatureProperties imageUrl can be null', () => {
    const globalPropsNoImage: GlobalPointFeatureProperties = {
      pointId: 'test-456',
      color: '#00ff00',
      selected: 1,
      userState: 'planned',
      bangumiId: 67890,
      imageUrl: null,
    }

    expectTypeOf(globalPropsNoImage).toMatchTypeOf<GlobalPointFeatureProperties>()
  })

  it('ThumbnailLoadState should have loaded Map, pending Set, and queue array', () => {
    const loadState: ThumbnailLoadState = {
      loaded: new Map<string, HTMLImageElement>(),
      pending: new Set<string>(),
      queue: [],
    }

    expectTypeOf(loadState.loaded).toEqualTypeOf<Map<string, HTMLImageElement>>()
    expectTypeOf(loadState.pending).toEqualTypeOf<Set<string>>()
    expectTypeOf(loadState.queue).toEqualTypeOf<string[]>()
  })

  it('ClusterFeatureProperties should match Supercluster output shape', () => {
    const clusterProps: ClusterFeatureProperties = {
      cluster: true,
      cluster_id: 42,
      point_count: 15,
    }

    expectTypeOf(clusterProps.cluster).toEqualTypeOf<boolean>()
    expectTypeOf(clusterProps.cluster_id).toEqualTypeOf<number>()
    expectTypeOf(clusterProps.point_count).toEqualTypeOf<number>()
  })
})
