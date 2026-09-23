/**
 * RoutePreviewMap 的 GeoJSON 组装与图层挂载：把 points / routeGeometry / legs
 * 归一成 FeatureCollection 并保证各 line/symbol 图层存在（setStyle 后由调用方重跑）。
 *
 * legs 为可选扩展（行程本按天分段）：传入时忽略 routeGeometry，逐段成 feature，
 * dashed 段走独立 dasharray 图层；底层 casing 线宽 8、上层主线宽 4。
 */
import maplibregl from 'maplibre-gl'
import { distanceMeters, type RoutePreviewPoint } from './routePreviewMarkers'

export type PreviewLineKind = 'route' | 'schematic' | 'jump' | 'leg'

export type RoutePreviewLeg = { coordinates: [number, number][]; dashed?: boolean }

export type PreviewLineProperties = {
  kind: PreviewLineKind
  dashed?: boolean
}

export type PreviewLabelProperties = {
  label: string
}

export type PreviewData = {
  lineCollection: GeoJSON.FeatureCollection<GeoJSON.LineString, PreviewLineProperties>
  labelCollection: GeoJSON.FeatureCollection<GeoJSON.Point, PreviewLabelProperties>
  hasFallback: boolean
  hasLongJump: boolean
}

type RouteGeometry = { type: 'LineString'; coordinates: [number, number][] } | null

const LINE_SOURCE_ID = 'route-preview-lines'
const LABEL_SOURCE_ID = 'route-preview-labels'
const ROUTE_LAYER_ID = 'route-preview-route-line'
const SCHEMATIC_LAYER_ID = 'route-preview-schematic-line'
const JUMP_LAYER_ID = 'route-preview-jump-line'
const JUMP_LABEL_LAYER_ID = 'route-preview-jump-label'
const LEG_CASING_LAYER_ID = 'route-preview-leg-casing'
const LEG_LAYER_ID = 'route-preview-leg-line'
const LEG_DASHED_LAYER_ID = 'route-preview-leg-line-dashed'
const ROUTE_LONG_JUMP_METERS = 80_000

export const PREVIEW_DEFAULT_CENTER: [number, number] = [139.767125, 35.681236]
export const ROUTE_SPREAD_HINT_METERS = 120_000

function toLngLat(point: { lat: number; lng: number }): [number, number] {
  return [point.lng, point.lat]
}

export function buildPreviewData(
  points: RoutePreviewPoint[],
  routeGeometry: RouteGeometry,
  legs?: RoutePreviewLeg[],
): PreviewData {
  if (legs !== undefined) {
    const lineFeatures = legs
      .filter((leg) => leg.coordinates.length >= 2)
      .map<GeoJSON.Feature<GeoJSON.LineString, PreviewLineProperties>>((leg) => ({
        type: 'Feature',
        properties: { kind: 'leg', dashed: leg.dashed === true },
        geometry: { type: 'LineString', coordinates: leg.coordinates },
      }))
    return {
      lineCollection: { type: 'FeatureCollection', features: lineFeatures },
      labelCollection: { type: 'FeatureCollection', features: [] },
      hasFallback: false,
      hasLongJump: false,
    }
  }

  if (routeGeometry && routeGeometry.coordinates.length >= 2) {
    return {
      lineCollection: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { kind: 'route' },
            geometry: routeGeometry,
          },
        ],
      },
      labelCollection: { type: 'FeatureCollection', features: [] },
      hasFallback: false,
      hasLongJump: false,
    }
  }

  const lineFeatures: Array<GeoJSON.Feature<GeoJSON.LineString, PreviewLineProperties>> = []
  const labelFeatures: Array<GeoJSON.Feature<GeoJSON.Point, PreviewLabelProperties>> = []
  let hasLongJump = false

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!
    const end = points[index + 1]!
    const startCoord = toLngLat(start)
    const endCoord = toLngLat(end)
    const longJump = distanceMeters(startCoord, endCoord) >= ROUTE_LONG_JUMP_METERS
    hasLongJump ||= longJump

    lineFeatures.push({
      type: 'Feature',
      properties: { kind: longJump ? 'jump' : 'schematic' },
      geometry: {
        type: 'LineString',
        coordinates: [startCoord, endCoord],
      },
    })

    if (longJump) {
      labelFeatures.push({
        type: 'Feature',
        properties: { label: `${start.label}→${end.label}` },
        geometry: {
          type: 'Point',
          coordinates: [
            (startCoord[0] + endCoord[0]) / 2,
            (startCoord[1] + endCoord[1]) / 2,
          ],
        },
      })
    }
  }

  return {
    lineCollection: { type: 'FeatureCollection', features: lineFeatures },
    labelCollection: { type: 'FeatureCollection', features: labelFeatures },
    hasFallback: lineFeatures.length > 0,
    hasLongJump,
  }
}

export function buildRenderSignature(
  points: RoutePreviewPoint[],
  routeGeometry: RouteGeometry,
  legs?: RoutePreviewLeg[],
): string {
  const pointsSignature = points.map((point) => `${point.id}:${point.label}:${point.lat.toFixed(5)},${point.lng.toFixed(5)}`).join('|')
  if (legs !== undefined) {
    const legsSignature = legs
      .map((leg) => `${leg.dashed ? 'd' : 's'}:${leg.coordinates.length}:${leg.coordinates[0]?.join(',') ?? ''}:${leg.coordinates[leg.coordinates.length - 1]?.join(',') ?? ''}`)
      .join('|')
    return `${pointsSignature}|legs:${legsSignature}`
  }
  if (!routeGeometry?.coordinates.length) return `${pointsSignature}|nogeometry`
  const first = routeGeometry.coordinates[0]!
  const last = routeGeometry.coordinates[routeGeometry.coordinates.length - 1]!
  return `${pointsSignature}|geometry:${routeGeometry.coordinates.length}:${first.join(',')}:${last.join(',')}`
}

function collectCoords(
  points: RoutePreviewPoint[],
  routeGeometry: RouteGeometry,
  legs?: RoutePreviewLeg[],
): [number, number][] {
  if (legs !== undefined) {
    return [...legs.flatMap((leg) => leg.coordinates), ...points.map(toLngLat)]
  }
  if (routeGeometry?.coordinates.length) {
    return [...routeGeometry.coordinates, ...points.map(toLngLat)]
  }
  return points.map(toLngLat)
}

export function fitMapToPreview(
  map: maplibregl.Map,
  points: RoutePreviewPoint[],
  routeGeometry: RouteGeometry,
  legs: RoutePreviewLeg[] | undefined,
  compact: boolean,
) {
  const coords = collectCoords(points, routeGeometry, legs)
  if (!coords.length) {
    map.jumpTo({ center: PREVIEW_DEFAULT_CENTER, zoom: 5 })
    return
  }
  const bounds = new maplibregl.LngLatBounds(coords[0], coords[0])
  for (const coord of coords.slice(1)) bounds.extend(coord)
  map.fitBounds(bounds, {
    padding: compact ? 24 : 48,
    duration: 0,
    maxZoom: 14,
  })
}

export function syncPreviewSources(map: maplibregl.Map, previewData: PreviewData) {
  const lineSource = map.getSource(LINE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
  if (lineSource) lineSource.setData(previewData.lineCollection)
  else {
    map.addSource(LINE_SOURCE_ID, {
      type: 'geojson',
      data: previewData.lineCollection,
    })
  }

  const labelSource = map.getSource(LABEL_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
  if (labelSource) labelSource.setData(previewData.labelCollection)
  else {
    map.addSource(LABEL_SOURCE_ID, {
      type: 'geojson',
      data: previewData.labelCollection,
    })
  }

  if (!map.getLayer(ROUTE_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_LAYER_ID,
      type: 'line',
      source: LINE_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'route'],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#e11d48',
        'line-width': 4,
      },
    })
  }

  if (!map.getLayer(LEG_CASING_LAYER_ID)) {
    map.addLayer({
      id: LEG_CASING_LAYER_ID,
      type: 'line',
      source: LINE_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'leg'],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#7c2d3a',
        'line-width': 8,
        'line-opacity': 0.35,
      },
    })
  }

  if (!map.getLayer(LEG_LAYER_ID)) {
    map.addLayer({
      id: LEG_LAYER_ID,
      type: 'line',
      source: LINE_SOURCE_ID,
      filter: ['all', ['==', ['get', 'kind'], 'leg'], ['!=', ['get', 'dashed'], true]],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#f43f5e',
        'line-width': 4,
      },
    })
  }

  if (!map.getLayer(LEG_DASHED_LAYER_ID)) {
    map.addLayer({
      id: LEG_DASHED_LAYER_ID,
      type: 'line',
      source: LINE_SOURCE_ID,
      filter: ['all', ['==', ['get', 'kind'], 'leg'], ['==', ['get', 'dashed'], true]],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#f43f5e',
        'line-width': 4,
        'line-dasharray': [2, 2],
      },
    })
  }

  if (!map.getLayer(SCHEMATIC_LAYER_ID)) {
    map.addLayer({
      id: SCHEMATIC_LAYER_ID,
      type: 'line',
      source: LINE_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'schematic'],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#e11d48',
        'line-width': 3,
        'line-opacity': 0.48,
        'line-dasharray': [2, 2],
      },
    })
  }

  if (!map.getLayer(JUMP_LAYER_ID)) {
    map.addLayer({
      id: JUMP_LAYER_ID,
      type: 'line',
      source: LINE_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'jump'],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#fb7185',
        'line-width': 3,
        'line-opacity': 0.78,
        'line-dasharray': [1, 2.2],
      },
    })
  }

  if (!map.getLayer(JUMP_LABEL_LAYER_ID)) {
    map.addLayer({
      id: JUMP_LABEL_LAYER_ID,
      type: 'symbol',
      source: LABEL_SOURCE_ID,
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 11,
        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#be123c',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
      },
    })
  }
}
