import { describe, it, expect } from 'vitest'
import { isWebglContextError } from '@/components/route/mapAvailability'

describe('isWebglContextError（WebGL 上下文创建失败识别）', () => {
  it('识别 MapLibre webglcontextcreationerror（message 含 WebGL）', () => {
    expect(isWebglContextError(new Error('webglcontextcreationerror: Failed to initialize WebGL'))).toBe(true)
  })

  it('识别 statusMessage 含 WebGL 的类 ErrorEvent 对象', () => {
    expect(isWebglContextError({ statusMessage: 'Failed to initialize WebGL' })).toBe(true)
    expect(isWebglContextError({ message: 'Map error', statusMessage: 'WebGL context lost' })).toBe(true)
  })

  it('大小写不敏感（webgl/WEBGL/WebGl）', () => {
    expect(isWebglContextError(new Error('WEBGL is disabled'))).toBe(true)
    expect(isWebglContextError({ message: 'webgl not supported by this browser' })).toBe(true)
    expect(isWebglContextError(new Error('WebGl context creation failed'))).toBe(true)
  })

  it('非 WebGL 错误不误判（style provider 401/403、网络错误等）', () => {
    expect(isWebglContextError(new Error('401 Unauthorized'))).toBe(false)
    expect(isWebglContextError(new Error('Failed to fetch tile: 403 Forbidden'))).toBe(false)
    expect(isWebglContextError(new Error('AJAXError: Not Found (404)'))).toBe(false)
  })

  it('null/undefined/数字等异常输入安全返回 false；字符串按 message 口径判定', () => {
    expect(isWebglContextError(null)).toBe(false)
    expect(isWebglContextError(undefined)).toBe(false)
    expect(isWebglContextError(42)).toBe(false)
    expect(isWebglContextError({})).toBe(false)
    expect(isWebglContextError('Failed to initialize WebGL')).toBe(true)
    expect(isWebglContextError('plain failure')).toBe(false)
  })

  it('message/statusMessage 为非字符串字段时忽略', () => {
    expect(isWebglContextError({ message: 123 })).toBe(false)
    expect(isWebglContextError({ statusMessage: null })).toBe(false)
  })
})
