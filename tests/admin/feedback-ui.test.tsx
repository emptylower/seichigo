import React, { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminToastProvider } from '@/components/admin/feedback/AdminToastProvider'
import { AdminToastViewport } from '@/components/admin/feedback/AdminToastViewport'
import { AdminConfirmProvider } from '@/components/admin/feedback/AdminConfirmProvider'
import { useAdminToast } from '@/hooks/useAdminToast'
import { useAdminConfirm } from '@/hooks/useAdminConfirm'

function ToastHarness() {
  const toast = useAdminToast()

  return (
    <div>
      <button type="button" onClick={() => toast.success('成功消息', '成功')}>success</button>
      <button type="button" onClick={() => toast.error('失败消息', '失败')}>error</button>
    </div>
  )
}

function ConfirmHarness() {
  const askForConfirm = useAdminConfirm()
  const [result, setResult] = useState('idle')

  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          const accepted = await askForConfirm({
            title: '确认危险操作',
            description: '该操作不可撤销',
            confirmLabel: '确认执行',
            cancelLabel: '取消',
            tone: 'danger',
          })
          setResult(accepted ? 'accepted' : 'cancelled')
        }}
      >
        open confirm
      </button>
      <div data-testid="confirm-result">{result}</div>
    </div>
  )
}

describe('admin feedback ui', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('auto dismisses success toast but keeps error toast until dismissed', () => {
    vi.useFakeTimers()

    render(
      <AdminToastProvider>
        <ToastHarness />
        <AdminToastViewport />
      </AdminToastProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'success' }))
    expect(screen.getByText('成功消息')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(2600)
    })
    expect(screen.queryByText('成功消息')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'error' }))
    expect(screen.getByText('失败消息')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByText('失败消息')).toBeInTheDocument()
  })

  it('resolves confirm dialog on confirm action', async () => {
    render(
      <AdminConfirmProvider>
        <ConfirmHarness />
      </AdminConfirmProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'open confirm' }))
    expect(await screen.findByText('确认危险操作')).toBeInTheDocument()
    expect(screen.getByText('该操作不可撤销')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(await screen.findByText('accepted')).toBeInTheDocument()
  })
})
