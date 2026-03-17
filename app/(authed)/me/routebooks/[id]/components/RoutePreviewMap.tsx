'use client'

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

export interface RoutePreviewMapProps {
  points: Array<{ lat: number; lng: number; label: string }>
  routeGeometry: { type: 'LineString'; coordinates: [number, number][] } | null
  className?: string
  compact?: boolean
}

function getMapStyleUrl(): string | maplibregl.StyleSpecification {
  const maptilerKey = String(process.env.NEXT_PUBLIC_MAPTILER_KEY || '').trim()
  const providerOrder = String(process.env.NEXT_PUBLIC_MAP_STYLE_PROVIDER_ORDER || 'maptiler,mapbox,stadia,raster').trim()
  
  const providers = providerOrder.split(',').map(p => p.trim().toLowerCase())
  
  if (providers.includes('maptiler') && maptilerKey) {
    return `https://api.maptiler.com/maps/dataviz/style.json?key=${encodeURIComponent(maptilerKey)}`
  }
  
  // Fallback to OSM raster
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors'
      }
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
  }
}

function createNumberedMarker(num: number, color: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'flex items-center justify-center rounded-full bg-white font-bold shadow-sm'
  el.style.width = '24px'
  el.style.height = '24px'
  el.style.border = `2px solid ${color}`
  el.style.color = color
  el.style.fontSize = '12px'
  el.innerText = String(num)
  return el
}

export function RoutePreviewMap({ points, routeGeometry, className = '', compact = false }: RoutePreviewMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])

  useEffect(() => {
    if (!containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getMapStyleUrl(),
      interactive: false,
      attributionControl: false,
    })
    
    mapRef.current = map

    map.on('load', () => {
      // Add route line source and layer
      const coordinates = routeGeometry?.coordinates || points.map(p => [p.lng, p.lat])
      
      map.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates
          }
        }
      })

      const isDashed = !routeGeometry
      const paintProps: maplibregl.LineLayerSpecification['paint'] = {
        'line-color': '#e11d48',
        'line-width': 4,
      }
      const layoutProps: maplibregl.LineLayerSpecification['layout'] = {
        'line-cap': 'round',
        'line-join': 'round',
      }
      
      if (isDashed) {
        paintProps['line-dasharray'] = [2, 2]
        paintProps['line-opacity'] = 0.5
      }

      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: layoutProps,
        paint: paintProps
      })

      // Add markers
      points.forEach((point, index) => {
        const el = createNumberedMarker(index + 1, '#e11d48')
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([point.lng, point.lat])
          .addTo(map)
        markersRef.current.push(marker)
      })

      // Fit bounds
      if (points.length > 0) {
        let minLng = points[0].lng
        let maxLng = points[0].lng
        let minLat = points[0].lat
        let maxLat = points[0].lat

        points.forEach(p => {
          if (p.lng < minLng) minLng = p.lng
          if (p.lng > maxLng) maxLng = p.lng
          if (p.lat < minLat) minLat = p.lat
          if (p.lat > maxLat) maxLat = p.lat
        })

        if (routeGeometry) {
          routeGeometry.coordinates.forEach(coord => {
            if (coord[0] < minLng) minLng = coord[0]
            if (coord[0] > maxLng) maxLng = coord[0]
            if (coord[1] < minLat) minLat = coord[1]
            if (coord[1] > maxLat) maxLat = coord[1]
          })
        }

        map.fitBounds(
          [[minLng, minLat], [maxLng, maxLat]],
          { padding: compact ? 12 : 24, duration: 0, maxZoom: 14 }
        )
      }
    })

    return () => {
      markersRef.current.forEach(m => m.remove())
      markersRef.current = []
      map.remove()
      mapRef.current = null
    }
  }, []) // Empty dependency array for initialization

  // Handle updates to routeGeometry or points
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    const source = map.getSource('route') as maplibregl.GeoJSONSource
    if (source) {
      const coordinates = routeGeometry?.coordinates || points.map(p => [p.lng, p.lat])
      source.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates
        }
      })
      
      // Update line style if switching between dashed and solid
      if (map.getLayer('route-line')) {
        if (routeGeometry) {
          map.setPaintProperty('route-line', 'line-dasharray', undefined)
          map.setPaintProperty('route-line', 'line-opacity', 1)
        } else {
          map.setPaintProperty('route-line', 'line-dasharray', [2, 2])
          map.setPaintProperty('route-line', 'line-opacity', 0.5)
        }
      }
    }

    // Update markers
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []
    
    points.forEach((point, index) => {
      const el = createNumberedMarker(index + 1, '#e11d48')
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([point.lng, point.lat])
        .addTo(map)
      markersRef.current.push(marker)
    })

    // Fit bounds
    if (points.length > 0) {
      let minLng = points[0].lng
      let maxLng = points[0].lng
      let minLat = points[0].lat
      let maxLat = points[0].lat

      points.forEach(p => {
        if (p.lng < minLng) minLng = p.lng
        if (p.lng > maxLng) maxLng = p.lng
        if (p.lat < minLat) minLat = p.lat
        if (p.lat > maxLat) maxLat = p.lat
      })

      if (routeGeometry) {
        routeGeometry.coordinates.forEach(coord => {
          if (coord[0] < minLng) minLng = coord[0]
          if (coord[0] > maxLng) maxLng = coord[0]
          if (coord[1] < minLat) minLat = coord[1]
          if (coord[1] > maxLat) maxLat = coord[1]
        })
      }

      map.fitBounds(
        [[minLng, minLat], [maxLng, maxLat]],
        { padding: compact ? 12 : 24, duration: 0, maxZoom: 14 }
      )
    }
  }, [points, routeGeometry, compact])

  if (points.length === 0) {
    return (
      <div className={`bg-gray-100 flex items-center justify-center text-gray-400 ${className}`}>
        No points to display
      </div>
    )
  }

  return (
    <div ref={containerRef} className={`w-full h-full bg-gray-100 ${className}`} />
  )
}
