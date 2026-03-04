export function isAdminSession(session: unknown): boolean {
  const user = (session as { user?: { isAdmin?: unknown } } | null)?.user
  return Boolean(user?.isAdmin)
}

export function clampInt(value: string | null, fallback: number, opts?: { min?: number; max?: number }): number {
  const min = opts?.min ?? 1
  const max = opts?.max ?? 100
  const raw = value ? Number.parseInt(value, 10) : Number.NaN
  if (!Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, raw))
}
