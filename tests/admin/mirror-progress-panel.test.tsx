import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MirrorProgressPanel from '@/app/(authed)/admin/ops/map-image-diagnostics/MirrorProgressPanel'

const baseStatusPayload = {
  totals: {
    all: 20,
    pending: 4,
    in_progress: 2,
    mirrored: 10,
    failed: 3,
    skipped_404: 1,
  },
  bootstrap: {
    bangumiCursor: 12,
    pointCursor: 'pt-7',
    bangumiCompleted: false,
    pointCompleted: true,
    totalEnumerated: 99,
    startedAt: '2026-05-03T00:00:00.000Z',
    completedAt: null,
    lastAdvanceAt: '2026-05-03T01:00:00.000Z',
    manuallyTriggered: true,
  },
  recentFailures: [
    {
      canonicalUrl: 'https://img.example.com/episodes/001/frame.webp',
      lastError: 'HTTP 502',
      attempts: 3,
      lastAttemptAt: '2026-05-03T01:02:03.000Z',
    },
  ],
  rates: {
    remaining: 6,
    mirroredLast1h: 4,
    mirroredLast24h: 11,
    ratePerSec: 0.1,
    estimatedRemainingHours: 1.5,
  },
}

describe('MirrorProgressPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn()
  })

  it('loads and renders mirror status details', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(baseStatusPayload),
    })

    render(<MirrorProgressPanel />)

    await waitFor(() => {
      expect(screen.getByText('镜像覆盖率')).toBeInTheDocument()
    })

    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('已镜像 10 / 总量 20')).toBeInTheDocument()
    expect(screen.getByText('剩余待处理：6')).toBeInTheDocument()
    expect(screen.getByText('6.0 张/分钟')).toBeInTheDocument()
    expect(screen.getByText('预计约 1.5 小时')).toBeInTheDocument()
    expect(screen.getByText('Bangumi 未完成')).toBeInTheDocument()
    expect(screen.getByText('Point 已完成')).toBeInTheDocument()
    expect(screen.getByText('HTTP 502')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/anitabi/image-mirror/status', {
      method: 'GET',
      credentials: 'include',
    })
  })

  it('posts bootstrap action and refreshes status', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(baseStatusPayload),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          elapsedMs: 321,
          stillNeedsManualPush: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ...baseStatusPayload,
          totals: {
            ...baseStatusPayload.totals,
            mirrored: 11,
            pending: 3,
          },
          rates: {
            ...baseStatusPayload.rates,
            remaining: 5,
          },
        }),
      })

    render(<MirrorProgressPanel />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '推进一次' })).toBeEnabled()
    })

    fireEvent.click(screen.getByRole('button', { name: '推进一次' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/anitabi/image-mirror/bootstrap', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'advance' }),
      })
    })

    await waitFor(() => {
      expect(screen.getByText('推进一次已触发（耗时 321ms），仍需继续推进。')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByText('已镜像 11 / 总量 20')).toBeInTheDocument()
    })
  })
})
