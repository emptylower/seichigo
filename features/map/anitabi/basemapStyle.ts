import type { StyleSpecification } from 'maplibre-gl'

// 内联精简底图（street 模式）：把原来指向 api.maptiler.com/maps/streets-v2/style.json
// 的远程样式换成一份自定义 StyleSpecification 直接打进 bundle：
// 1. style.json / tiles.json 两跳串行 RTT 全省掉，JS 一就绪即可直接请求瓦片；
// 2. 只渲染 land / water / road / boundary / place-label，不引用任何 sprite 图标，
//    因此样式不声明 sprite 字段（streets-v2 的 sprite.png 约 94KB 直接不再加载）；
// 3. 图层 id 统一 base- 前缀，避免与点位 / complete 等应用层 id 冲突。
//
// 瓦片仍走 MapTiler tiles/v3（OpenMapTiles 全量 schema）——单块瓦片字节由服务端决定，
// 客户端无法裁剪；瘦掉的只是样式协议开销与渲染图层数。

const FONT_STACK = ['Roboto Regular', 'Noto Sans Regular'] as const

export const INLINE_BASEMAP_SOURCE_ID = 'openmaptiles'

function buildTileUrl(key: string): string {
  return `https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf?key=${encodeURIComponent(key)}`
}

function buildGlyphsUrl(key: string): string {
  return `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=${encodeURIComponent(key)}`
}

export function buildInlineMapTilerStreetStyle(key: string): StyleSpecification {
  const source: StyleSpecification['sources'][string] = {
    type: 'vector',
    tiles: [buildTileUrl(key)],
    minzoom: 0,
    maxzoom: 14,
    attribution:
      '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">&copy; MapTiler</a> '
      + '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap contributors</a>',
  }

  return {
    version: 8,
    name: 'seichigo-street-slim',
    glyphs: buildGlyphsUrl(key),
    sources: {
      [INLINE_BASEMAP_SOURCE_ID]: source,
    },
    layers: [
      {
        id: 'base-land',
        type: 'background',
        paint: { 'background-color': 'hsl(45, 24%, 93%)' },
      },
      {
        id: 'base-landcover',
        type: 'fill',
        'source-layer': 'landcover',
        source: INLINE_BASEMAP_SOURCE_ID,
        filter: ['match', ['get', 'class'], ['wood', 'forest', 'grass', 'scrub', 'grassland', 'wetland'], true, false],
        paint: {
          'fill-color': 'hsl(100, 32%, 86%)',
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.45, 10, 0.6],
        },
      },
      {
        id: 'base-landuse-park',
        type: 'fill',
        'source-layer': 'landuse',
        source: INLINE_BASEMAP_SOURCE_ID,
        minzoom: 9,
        filter: ['match', ['get', 'class'], ['park', 'garden', 'playground', 'golf_course', 'cemetery'], true, false],
        paint: { 'fill-color': 'hsl(100, 36%, 84%)' },
      },
      {
        id: 'base-water',
        type: 'fill',
        'source-layer': 'water',
        source: INLINE_BASEMAP_SOURCE_ID,
        paint: { 'fill-color': 'hsl(205, 69%, 74%)' },
      },
      {
        id: 'base-waterway',
        type: 'line',
        'source-layer': 'waterway',
        source: INLINE_BASEMAP_SOURCE_ID,
        minzoom: 8,
        paint: {
          'line-color': 'hsl(205, 69%, 68%)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 2.2],
        },
      },
      {
        id: 'base-road-casing',
        type: 'line',
        'source-layer': 'transportation',
        source: INLINE_BASEMAP_SOURCE_ID,
        filter: [
          'match',
          ['get', 'class'],
          ['motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link'],
          true,
          false,
        ],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': 'hsl(0, 0%, 72%)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.9, 10, 2.4, 14, 7, 18, 14],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 8, 1],
        },
      },
      {
        id: 'base-road-minor',
        type: 'line',
        'source-layer': 'transportation',
        source: INLINE_BASEMAP_SOURCE_ID,
        minzoom: 11,
        filter: [
          'match',
          ['get', 'class'],
          ['tertiary', 'unclassified', 'residential', 'minor', 'service', 'tertiary_link', 'track'],
          true,
          false,
        ],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': 'hsl(0, 0%, 99%)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 14, 2.6, 18, 8],
        },
      },
      {
        id: 'base-road-major',
        type: 'line',
        'source-layer': 'transportation',
        source: INLINE_BASEMAP_SOURCE_ID,
        filter: [
          'match',
          ['get', 'class'],
          ['motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link'],
          true,
          false,
        ],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': 'hsl(0, 0%, 100%)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 1.8, 14, 5.4, 18, 11],
        },
      },
      {
        id: 'base-boundary-region',
        type: 'line',
        'source-layer': 'boundary',
        source: INLINE_BASEMAP_SOURCE_ID,
        minzoom: 4,
        filter: [
          'all',
          ['match', ['get', 'admin_level'], [3, 4, 5, 6], true, false],
          ['match', ['get', 'maritime'], [0], true, false],
        ],
        paint: {
          'line-color': 'hsl(0, 0%, 66%)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.5, 10, 1.4],
          'line-dasharray': [2, 1.4],
        },
      },
      {
        id: 'base-boundary-country',
        type: 'line',
        'source-layer': 'boundary',
        source: INLINE_BASEMAP_SOURCE_ID,
        filter: [
          'all',
          ['match', ['get', 'admin_level'], [2], true, false],
          ['match', ['get', 'maritime'], [0], true, false],
        ],
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': 'hsl(0, 0%, 52%)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.8, 8, 1.6, 14, 3],
        },
      },
      {
        id: 'base-label-country',
        type: 'symbol',
        'source-layer': 'place',
        source: INLINE_BASEMAP_SOURCE_ID,
        maxzoom: 8,
        filter: ['match', ['get', 'class'], ['country'], true, false],
        layout: {
          'text-field': '{name}',
          'text-font': [...FONT_STACK],
          'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10.5, 7, 17],
          'text-max-width': 8,
          'symbol-sort-key': ['to-number', ['get', 'rank'], 99],
        },
        paint: {
          'text-color': 'hsl(0, 0%, 32%)',
          'text-halo-color': 'hsla(0, 0%, 100%, 0.85)',
          'text-halo-width': 1.2,
        },
      },
      {
        id: 'base-label-state',
        type: 'symbol',
        'source-layer': 'place',
        source: INLINE_BASEMAP_SOURCE_ID,
        minzoom: 4,
        maxzoom: 9,
        filter: ['match', ['get', 'class'], ['state', 'province', 'region'], true, false],
        layout: {
          'text-field': '{name}',
          'text-font': [...FONT_STACK],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 9.5, 8, 13.5],
          'text-max-width': 7,
          'symbol-sort-key': ['to-number', ['get', 'rank'], 99],
        },
        paint: {
          'text-color': 'hsl(0, 0%, 42%)',
          'text-halo-color': 'hsla(0, 0%, 100%, 0.85)',
          'text-halo-width': 1.1,
        },
      },
      {
        id: 'base-label-city',
        type: 'symbol',
        'source-layer': 'place',
        source: INLINE_BASEMAP_SOURCE_ID,
        filter: ['match', ['get', 'class'], ['city'], true, false],
        layout: {
          'text-field': '{name}',
          'text-font': [...FONT_STACK],
          'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10.5, 12, 16],
          'text-max-width': 8,
          'symbol-sort-key': ['to-number', ['get', 'rank'], 99],
        },
        paint: {
          'text-color': 'hsl(0, 0%, 28%)',
          'text-halo-color': 'hsla(0, 0%, 100%, 0.9)',
          'text-halo-width': 1.3,
        },
      },
      {
        id: 'base-label-town',
        type: 'symbol',
        'source-layer': 'place',
        source: INLINE_BASEMAP_SOURCE_ID,
        minzoom: 9,
        filter: ['match', ['get', 'class'], ['town', 'village', 'suburb', 'neighbourhood', 'hamlet'], true, false],
        layout: {
          'text-field': '{name}',
          'text-font': [...FONT_STACK],
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 9.5, 14, 12.5],
          'text-max-width': 7,
          'symbol-sort-key': ['to-number', ['get', 'rank'], 99],
        },
        paint: {
          'text-color': 'hsl(0, 0%, 36%)',
          'text-halo-color': 'hsla(0, 0%, 100%, 0.9)',
          'text-halo-width': 1.1,
        },
      },
    ],
  }
}
