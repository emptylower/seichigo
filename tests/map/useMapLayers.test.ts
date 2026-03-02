import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  SIMPLE_POINT_SOURCE_ID,
  SIMPLE_POINT_LAYER_ID,
  SIMPLE_POINT_SELECTED_HALO_LAYER_ID,
  SIMPLE_POINT_SELECTED_LAYER_ID,
  removeSimpleModeLayers,
  ensureSimpleModeLayers,
  getSimplePointLayerIds,
  readPointIdFromRendered,
  flushSimpleModeLayers,
} from '@/components/map/hooks/useMapLayers'

// ---------------------------------------------------------------------------
// Mock MapLibre Map (same pattern as completeModeLayers.test.ts)
// ---------------------------------------------------------------------------

interface MockLayer {
  id: string
  type: string
  source: string
  paint?: Record<string, unknown>
  filter?: unknown[]
}

interface MockSource {
  type: string
  data?: GeoJSON.FeatureCollection
  setData?: ReturnType<typeof vi.fn>
}

function createMockMap() {
  const sources = new Map<string, MockSource>()
  const layers = new Map<string, MockLayer>()

  const map = {
    getSource: vi.fn((id: string) => sources.get(id) ?? null),
    getLayer: vi.fn((id: string) => layers.get(id) ?? null),
    addSource: vi.fn((id: string, spec: MockSource) => {
      if (sources.has(id)) throw new Error(`Source "${id}" already exists`)
      sources.set(id, {
        ...spec,
        setData: vi.fn((data: GeoJSON.FeatureCollection) => {
          const s = sources.get(id)
          if (s) s.data = data
        }),
      })
    }),
    addLayer: vi.fn((spec: MockLayer) => {
      if (layers.has(spec.id)) throw new Error(`Layer "${spec.id}" already exists`)
      layers.set(spec.id, spec)
    }),
    removeSource: vi.fn((id: string) => {
      sources.delete(id)
    }),
    removeLayer: vi.fn((id: string) => {
      layers.delete(id)
    }),
    isStyleLoaded: vi.fn(() => true),
    triggerRepaint: vi.fn(),
    queryRenderedFeatures: vi.fn(() => []),
    _sources: sources,
    _layers: layers,
  }
  return map
}

type MockMap = ReturnType<typeof createMockMap>

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

function sampleFC(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [139.7, 35.6] },
        properties: { pointId: 'p1', color: '#6d28d9', selected: 0, userState: '' },
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useMapLayers – pure functions', () => {
  let map: MockMap

  beforeEach(() => {
    map = createMockMap()
  })

  // ---- Constants ----

  describe('constants', () => {
    it('should export expected layer/source IDs', () => {
      expect(SIMPLE_POINT_SOURCE_ID).toBe('anitabi-bangumi-point-source')
      expect(SIMPLE_POINT_LAYER_ID).toBe('anitabi-bangumi-point-layer')
      expect(SIMPLE_POINT_SELECTED_HALO_LAYER_ID).toBe('anitabi-bangumi-point-selected-halo-layer')
      expect(SIMPLE_POINT_SELECTED_LAYER_ID).toBe('anitabi-bangumi-point-selected-layer')
    })
  })

  // ---- ensureSimpleModeLayers ----

  describe('ensureSimpleModeLayers', () => {
    it('should create source and 3 layers on first call', () => {
      const data = sampleFC()
      const ok = ensureSimpleModeLayers(map as any, data)

      expect(ok).toBe(true)
      expect(map.addSource).toHaveBeenCalledWith(
        SIMPLE_POINT_SOURCE_ID,
        expect.objectContaining({ type: 'geojson', data })
      )
      expect(map.addLayer).toHaveBeenCalledTimes(3)

      // Verify layer IDs in order
      const layerIds = (map.addLayer as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => (c[0] as MockLayer).id
      )
      expect(layerIds).toEqual([
        SIMPLE_POINT_LAYER_ID,
        SIMPLE_POINT_SELECTED_HALO_LAYER_ID,
        SIMPLE_POINT_SELECTED_LAYER_ID,
      ])
    })

    it('should return true immediately if source and all layers already exist', () => {
      // First call creates everything
      ensureSimpleModeLayers(map as any, sampleFC())
      map.addSource.mockClear()
      map.addLayer.mockClear()

      // Second call should be a no-op
      const ok = ensureSimpleModeLayers(map as any, sampleFC())
      expect(ok).toBe(true)
      expect(map.addSource).not.toHaveBeenCalled()
      expect(map.addLayer).not.toHaveBeenCalled()
    })

    it('should recover from addLayer error by cleaning up and returning false', () => {
      // Make the second addLayer call throw
      let callCount = 0
      map.addLayer.mockImplementation((spec: MockLayer) => {
        callCount++
        if (callCount === 2) throw new Error('GL error')
        map._layers.set(spec.id, spec)
      })

      const ok = ensureSimpleModeLayers(map as any, sampleFC())
      expect(ok).toBe(false)
      // Should have attempted cleanup via removeSimpleModeLayers
      expect(map.removeLayer).toHaveBeenCalled()
    })

    it('should recreate layers when source exists but layers are missing', () => {
      // Add source only
      map.addSource(SIMPLE_POINT_SOURCE_ID, { type: 'geojson', data: emptyFC() })
      map.addSource.mockClear()

      const ok = ensureSimpleModeLayers(map as any, sampleFC())
      expect(ok).toBe(true)
      // Should have removed old source and re-added everything
      expect(map.removeSource).toHaveBeenCalled()
      expect(map.addSource).toHaveBeenCalled()
      expect(map.addLayer).toHaveBeenCalledTimes(3)
    })
  })

  // ---- removeSimpleModeLayers ----

  describe('removeSimpleModeLayers', () => {
    it('should remove all layers and source', () => {
      ensureSimpleModeLayers(map as any, sampleFC())
      removeSimpleModeLayers(map as any)

      expect(map.removeLayer).toHaveBeenCalledWith(SIMPLE_POINT_SELECTED_LAYER_ID)
      expect(map.removeLayer).toHaveBeenCalledWith(SIMPLE_POINT_SELECTED_HALO_LAYER_ID)
      expect(map.removeLayer).toHaveBeenCalledWith(SIMPLE_POINT_LAYER_ID)
      expect(map.removeSource).toHaveBeenCalledWith(SIMPLE_POINT_SOURCE_ID)
    })

    it('should be safe to call when no layers/source exist', () => {
      // Should not throw
      removeSimpleModeLayers(map as any)
      expect(map.removeLayer).not.toHaveBeenCalled()
      expect(map.removeSource).not.toHaveBeenCalled()
    })
  })

  // ---- getSimplePointLayerIds ----

  describe('getSimplePointLayerIds', () => {
    it('should return IDs of existing layers only', () => {
      ensureSimpleModeLayers(map as any, sampleFC())
      const ids = getSimplePointLayerIds(map as any)
      expect(ids).toEqual([SIMPLE_POINT_SELECTED_LAYER_ID, SIMPLE_POINT_LAYER_ID])
    })

    it('should return empty array when no layers exist', () => {
      const ids = getSimplePointLayerIds(map as any)
      expect(ids).toEqual([])
    })
  })

  // ---- readPointIdFromRendered ----

  describe('readPointIdFromRendered', () => {
    it('should return pointId from first hit feature', () => {
      ensureSimpleModeLayers(map as any, sampleFC())
      map.queryRenderedFeatures.mockReturnValue([
        { properties: { pointId: 'abc123' } },
      ] as any)

      const result = readPointIdFromRendered(map as any, [100, 200] as any)
      expect(result).toBe('abc123')
    })

    it('should return null when no features hit', () => {
      ensureSimpleModeLayers(map as any, sampleFC())
      map.queryRenderedFeatures.mockReturnValue([])

      const result = readPointIdFromRendered(map as any, [100, 200] as any)
      expect(result).toBeNull()
    })

    it('should return null when no point layers exist', () => {
      const result = readPointIdFromRendered(map as any, [100, 200] as any)
      expect(result).toBeNull()
      expect(map.queryRenderedFeatures).not.toHaveBeenCalled()
    })
  })

  // ---- flushSimpleModeLayers ----

  describe('flushSimpleModeLayers', () => {
    it('should remove layers and return true when hasDetail is false', () => {
      // Pre-create layers
      ensureSimpleModeLayers(map as any, sampleFC())

      const ok = flushSimpleModeLayers(map as any, emptyFC(), false)
      expect(ok).toBe(true)
      expect(map.removeLayer).toHaveBeenCalled()
    })

    it('should ensure layers, setData, and return true when hasDetail is true', () => {
      const data = sampleFC()
      const ok = flushSimpleModeLayers(map as any, data, true)
      expect(ok).toBe(true)

      // Source should exist and setData called
      const src = map._sources.get(SIMPLE_POINT_SOURCE_ID)
      expect(src).toBeDefined()
      expect(src!.setData).toHaveBeenCalledWith(data)
      expect(map.triggerRepaint).toHaveBeenCalled()
    })

    it('should return false when ensureSimpleModeLayers fails', () => {
      // Make addSource throw
      map.addSource.mockImplementation(() => {
        throw new Error('GL context lost')
      })

      const ok = flushSimpleModeLayers(map as any, sampleFC(), true)
      expect(ok).toBe(false)
    })
  })
})
