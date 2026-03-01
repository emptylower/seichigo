import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMapMode } from '@/components/map/hooks/useMapMode'

describe('useMapMode', () => {
  const originalLocation = window.location
  const originalInnerWidth = window.innerWidth

  beforeEach(() => {
    // Reset localStorage
    localStorage.clear()
    
    // Reset window.innerWidth
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    })

    // Mock window.location
    delete (window as any).location
    window.location = { ...originalLocation, search: '' } as any

    // Mock history.replaceState
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
  })

  afterEach(() => {
    window.location = originalLocation as any
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    })
    vi.restoreAllMocks()
  })

  describe('Priority chain: URL > localStorage > device default', () => {
    it('should return "complete" when URL has ?mode=complete', () => {
      window.location.search = '?mode=complete'
      localStorage.setItem('map-mode', 'simple')
      Object.defineProperty(window, 'innerWidth', { value: 500, writable: true })

      const { result } = renderHook(() => useMapMode())

      expect(result.current.mode).toBe('complete')
      expect(result.current.isComplete).toBe(true)
      expect(result.current.isSimple).toBe(false)
    })

    it('should return "simple" when URL has ?mode=simple', () => {
      window.location.search = '?mode=simple'
      localStorage.setItem('map-mode', 'complete')
      Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true })

      const { result } = renderHook(() => useMapMode())

      expect(result.current.mode).toBe('simple')
      expect(result.current.isComplete).toBe(false)
      expect(result.current.isSimple).toBe(true)
    })

    it('should return localStorage value when no URL param (localStorage=simple)', () => {
      window.location.search = ''
      localStorage.setItem('map-mode', 'simple')
      Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true })

      const { result } = renderHook(() => useMapMode())

      expect(result.current.mode).toBe('simple')
    })

    it('should return localStorage value when no URL param (localStorage=complete)', () => {
      window.location.search = ''
      localStorage.setItem('map-mode', 'complete')
      Object.defineProperty(window, 'innerWidth', { value: 500, writable: true })

      const { result } = renderHook(() => useMapMode())

      expect(result.current.mode).toBe('complete')
    })

    it('should return "complete" on desktop when no URL param and no localStorage', () => {
      window.location.search = ''
      localStorage.removeItem('map-mode')
      Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true })

      const { result } = renderHook(() => useMapMode())

      expect(result.current.mode).toBe('complete')
    })

    it('should return "simple" on mobile when no URL param and no localStorage', () => {
      window.location.search = ''
      localStorage.removeItem('map-mode')
      Object.defineProperty(window, 'innerWidth', { value: 1023, writable: true })

      const { result } = renderHook(() => useMapMode())

      expect(result.current.mode).toBe('simple')
    })
  })

  describe('setMode behavior', () => {
    it('should update state, localStorage, and URL when calling setMode', () => {
      window.location.search = ''
      localStorage.removeItem('map-mode')

      const { result } = renderHook(() => useMapMode())

      act(() => {
        result.current.setMode('simple')
      })

      expect(result.current.mode).toBe('simple')
      expect(localStorage.getItem('map-mode')).toBe('simple')
      expect(window.history.replaceState).toHaveBeenCalledWith(
        null,
        '',
        expect.stringContaining('mode=simple')
      )
    })

    it('should update from simple to complete', () => {
      window.location.search = '?mode=simple'
      localStorage.setItem('map-mode', 'simple')

      const { result } = renderHook(() => useMapMode())

      act(() => {
        result.current.setMode('complete')
      })

      expect(result.current.mode).toBe('complete')
      expect(localStorage.getItem('map-mode')).toBe('complete')
      expect(window.history.replaceState).toHaveBeenCalledWith(
        null,
        '',
        expect.stringContaining('mode=complete')
      )
    })
  })

  describe('Boolean shortcuts', () => {
    it('should provide isComplete=true when mode is complete', () => {
      window.location.search = '?mode=complete'

      const { result } = renderHook(() => useMapMode())

      expect(result.current.isComplete).toBe(true)
      expect(result.current.isSimple).toBe(false)
    })

    it('should provide isSimple=true when mode is simple', () => {
      window.location.search = '?mode=simple'

      const { result } = renderHook(() => useMapMode())

      expect(result.current.isComplete).toBe(false)
      expect(result.current.isSimple).toBe(true)
    })
  })
})
