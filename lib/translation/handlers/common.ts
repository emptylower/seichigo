export function isAdminSession(session: unknown): boolean {
  const user = (session as { user?: { isAdmin?: unknown } } | null)?.user
  return Boolean(user?.isAdmin)
}
