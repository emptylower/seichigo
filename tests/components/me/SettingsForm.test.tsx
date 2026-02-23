import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ProfileData } from '@/lib/profile/types'

const refreshMock = vi.fn()
const updateSessionMock = vi.fn()
const fetchMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    update: updateSessionMock,
  }),
}))

vi.mock('@/components/shared/CoverField', () => ({
  default: ({ value, onChange, label }: { value: string | null; onChange: (next: string | null) => void; label?: string }) => (
    <div>
      <label>{label || '头像'}</label>
      <input
        aria-label={label || '头像'}
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
      />
    </div>
  ),
}))

import SettingsForm from '@/components/me/SettingsForm.client'

const initialData: ProfileData = {
  name: '旧昵称',
  image: null,
  bio: null,
  bilibili: null,
  weibo: null,
  github: null,
  twitter: null,
}

describe('SettingsForm', () => {
  beforeEach(() => {
    refreshMock.mockReset()
    updateSessionMock.mockReset()
    fetchMock.mockReset()

    updateSessionMock.mockResolvedValue(null)
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ...initialData,
          name: '西行树',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )
    ;(globalThis as any).fetch = fetchMock
  })

  it('updates session and refreshes route after successful save', async () => {
    render(<SettingsForm initialData={initialData} />)

    fireEvent.change(screen.getByLabelText('昵称'), { target: { value: '西行树' } })
    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/me/profile')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body)).name).toBe('西行树')

    await waitFor(() => expect(updateSessionMock).toHaveBeenCalledTimes(1))
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('still refreshes route when session update fails', async () => {
    updateSessionMock.mockRejectedValueOnce(new Error('session update failed'))

    render(<SettingsForm initialData={initialData} />)
    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(updateSessionMock).toHaveBeenCalledTimes(1))
    expect(refreshMock).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('保存成功！')).toBeInTheDocument()
  })
})
