/**
 * 登录态提示 cookie（性能优化 2026-09-07）：middleware 根据 next-auth 会话
 * cookie 在响应上打非 httpOnly 标记 `sg_auth=1`。客户端据此判断"可能已登录"，
 * 没有标记时跳过 `/api/auth/session` 与 `/api/me/usage` 的初始化请求。
 * 它只是性能提示，不是授权依据——授权一律以服务端会话为准。
 */
export const AUTH_HINT_COOKIE = 'sg_auth'

const AUTH_HINT_PATTERN = /(?:^|;\s*)sg_auth=1(?:;|$)/

/** 客户端读标记；SSR（无 document）一律视为无标记 */
export function hasAuthHintCookie(): boolean {
  if (typeof document === 'undefined') return false
  return AUTH_HINT_PATTERN.test(document.cookie)
}
