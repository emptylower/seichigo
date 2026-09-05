/**
 * RoutePreviewMap 可用性判定纯逻辑。
 *
 * `new maplibregl.Map()` 在浏览器不支持/禁用 WebGL 时同步抛出
 * （如 `webglcontextcreationerror: Failed to initialize WebGL`）。
 * 该错误属于环境性失败，应降级为占位 UI，而不是冒泡卸载整个页面。
 * 判定宽松：message/statusMessage 任一含 "webgl"（大小写不敏感）即命中。
 */
export function isWebglContextError(err: unknown): boolean {
  const candidates: string[] = []
  if (typeof err === 'string') {
    candidates.push(err)
  } else if (err !== null && typeof err === 'object') {
    const record = err as { message?: unknown; statusMessage?: unknown }
    if (typeof record.message === 'string') candidates.push(record.message)
    if (typeof record.statusMessage === 'string') candidates.push(record.statusMessage)
  }
  return candidates.some((text) => /webgl/i.test(text))
}
