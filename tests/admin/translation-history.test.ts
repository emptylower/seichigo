import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  prisma: {
    translationHistory: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => mocks.getSession(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: mocks.prisma,
}))

function jsonReq(url: string, method: string): NextRequest {
  return new NextRequest(url, { method })
}

describe('translation history API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('GET /api/admin/translations/[id]/history', () => {
    it('returns history list for translation task', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.prisma.translationHistory.findMany.mockResolvedValue([
        {
          id: 'hist-1',
          translationTaskId: 'task-1',
          title: 'Version 2',
          content: { name_en: 'Updated Name' },
          createdAt: new Date('2026-02-02T10:00:00Z'),
          createdById: 'admin-1',
          createdBy: { name: 'Admin User', email: 'admin@example.com' },
        },
        {
          id: 'hist-2',
          translationTaskId: 'task-1',
          title: 'Version 1',
          content: { name_en: 'Original Name' },
          createdAt: new Date('2026-02-01T10:00:00Z'),
          createdById: 'admin-1',
          createdBy: { name: 'Admin User', email: 'admin@example.com' },
        },
      ])

      const handlers = await import('app/api/admin/translations/[id]/history/route')
      const res = await handlers.GET(
        jsonReq('http://localhost/api/admin/translations/task-1/history', 'GET'),
        { params: Promise.resolve({ id: 'task-1' }) }
      )

      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.history).toHaveLength(2)
      expect(j.history[0].id).toBe('hist-1')
      expect(j.history[0].title).toBe('Version 2')
      expect(j.history[0].createdBy.name).toBe('Admin User')
      expect(j.history[1].id).toBe('hist-2')
    })

    it('returns history ordered by createdAt descending', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.prisma.translationHistory.findMany.mockResolvedValue([
        {
          id: 'hist-3',
          translationTaskId: 'task-1',
          title: 'Latest',
          content: {},
          createdAt: new Date('2026-02-03T10:00:00Z'),
          createdById: 'admin-1',
          createdBy: { name: 'Admin', email: 'admin@example.com' },
        },
        {
          id: 'hist-1',
          translationTaskId: 'task-1',
          title: 'Oldest',
          content: {},
          createdAt: new Date('2026-02-01T10:00:00Z'),
          createdById: 'admin-1',
          createdBy: { name: 'Admin', email: 'admin@example.com' },
        },
      ])

      const handlers = await import('app/api/admin/translations/[id]/history/route')
      const res = await handlers.GET(
        jsonReq('http://localhost/api/admin/translations/task-1/history', 'GET'),
        { params: Promise.resolve({ id: 'task-1' }) }
      )

      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.history[0].id).toBe('hist-3')
      expect(j.history[1].id).toBe('hist-1')

      expect(mocks.prisma.translationHistory.findMany).toHaveBeenCalledWith({
        where: { translationTaskId: 'task-1' },
        orderBy: { createdAt: 'desc' },
        include: { createdBy: { select: { name: true, email: true } } },
      })
    })

    it('includes creator information in history items', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.prisma.translationHistory.findMany.mockResolvedValue([
        {
          id: 'hist-1',
          translationTaskId: 'task-1',
          title: 'Version 1',
          content: {},
          createdAt: new Date('2026-02-01T10:00:00Z'),
          createdById: 'admin-2',
          createdBy: { name: 'Another Admin', email: 'another@example.com' },
        },
      ])

      const handlers = await import('app/api/admin/translations/[id]/history/route')
      const res = await handlers.GET(
        jsonReq('http://localhost/api/admin/translations/task-1/history', 'GET'),
        { params: Promise.resolve({ id: 'task-1' }) }
      )

      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.history[0].createdBy).toEqual({
        name: 'Another Admin',
        email: 'another@example.com',
      })
    })

    it('returns empty array when no history exists', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } })
      mocks.prisma.translationHistory.findMany.mockResolvedValue([])

      const handlers = await import('app/api/admin/translations/[id]/history/route')
      const res = await handlers.GET(
        jsonReq('http://localhost/api/admin/translations/task-1/history', 'GET'),
        { params: Promise.resolve({ id: 'task-1' }) }
      )

      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.history).toEqual([])
    })

    it('rejects non-admin users', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })

      const handlers = await import('app/api/admin/translations/[id]/history/route')
      const res = await handlers.GET(
        jsonReq('http://localhost/api/admin/translations/task-1/history', 'GET'),
        { params: Promise.resolve({ id: 'task-1' }) }
      )

      expect(res.status).toBe(401)
      expect(mocks.prisma.translationHistory.findMany).not.toHaveBeenCalled()
    })

    it('rejects unauthenticated requests', async () => {
      mocks.getSession.mockResolvedValue(null)

      const handlers = await import('app/api/admin/translations/[id]/history/route')
      const res = await handlers.GET(
        jsonReq('http://localhost/api/admin/translations/task-1/history', 'GET'),
        { params: Promise.resolve({ id: 'task-1' }) }
      )

      expect(res.status).toBe(401)
      expect(mocks.prisma.translationHistory.findMany).not.toHaveBeenCalled()
    })
  })
})
