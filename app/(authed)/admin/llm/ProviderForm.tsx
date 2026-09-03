'use client'

import { useState } from 'react'
import Button from '@/components/shared/Button'
import type { LlmProtocol, LlmProviderView } from './types'
import { validateProviderValues, type ProviderFormValues } from './validation'

type ModelRow = { name: string; contextLength: string; maxOutputTokens: string }

type ProviderFormProps = {
  mode: 'create' | 'edit'
  provider?: LlmProviderView
  saving: boolean
  serverError: string | null
  onCancel: () => void
  onSubmit: (values: ProviderFormValues) => void
}

const inputClass =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500'

function rowsFromProvider(provider: LlmProviderView | undefined): ModelRow[] {
  if (provider && provider.models.length > 0) {
    return provider.models.map((m) => ({
      name: m.name,
      contextLength: String(m.contextLength),
      maxOutputTokens: m.maxOutputTokens === null || m.maxOutputTokens === undefined ? '' : String(m.maxOutputTokens),
    }))
  }
  return [{ name: '', contextLength: '128000', maxOutputTokens: '' }]
}

export default function ProviderForm({ mode, provider, saving, serverError, onCancel, onSubmit }: ProviderFormProps) {
  const [name, setName] = useState(provider?.name ?? '')
  const [protocol, setProtocol] = useState<LlmProtocol>(provider?.protocol ?? 'openai')
  const [endpointUrl, setEndpointUrl] = useState(provider?.endpointUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [enabled, setEnabled] = useState(provider?.enabled ?? true)
  const [rows, setRows] = useState<ModelRow[]>(() => rowsFromProvider(provider))
  const [localError, setLocalError] = useState<string | null>(null)

  const error = localError ?? serverError

  function updateRow(index: number, patch: Partial<ModelRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function removeRow(index: number) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const values: ProviderFormValues = {
      name,
      protocol,
      endpointUrl,
      apiKey,
      enabled,
      models: rows.map((row) => ({
        name: row.name,
        contextLength: Number(row.contextLength),
        maxOutputTokens: row.maxOutputTokens.trim() === '' ? null : Number(row.maxOutputTokens),
      })),
    }
    const message = validateProviderValues(values, mode)
    if (message) {
      setLocalError(message)
      return
    }
    setLocalError(null)
    onSubmit(values)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'create' ? '新建供应商' : '编辑供应商'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900">
          {mode === 'create' ? '新建供应商' : `编辑供应商「${provider?.name ?? ''}」`}
        </h2>

        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          {error ? (
            <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {error}
            </div>
          ) : null}

          <div>
            <label htmlFor="llm-form-name" className="mb-1 block text-sm font-medium text-gray-700">
              供应商名称
            </label>
            <input
              id="llm-form-name"
              type="text"
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="例如：DeepSeek 主"
            />
          </div>

          <fieldset>
            <legend className="mb-1 text-sm font-medium text-gray-700">协议</legend>
            <div className="flex gap-4 text-sm text-gray-700">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="llm-form-protocol"
                  checked={protocol === 'openai'}
                  onChange={() => setProtocol('openai')}
                />
                OpenAI 兼容
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="llm-form-protocol"
                  checked={protocol === 'anthropic'}
                  onChange={() => setProtocol('anthropic')}
                />
                Anthropic
              </label>
            </div>
          </fieldset>

          <div>
            <label htmlFor="llm-form-endpoint" className="mb-1 block text-sm font-medium text-gray-700">
              请求完整 URL
            </label>
            <input
              id="llm-form-endpoint"
              type="text"
              className={inputClass}
              value={endpointUrl}
              onChange={(e) => setEndpointUrl(e.target.value)}
              placeholder="https://api.deepseek.com/chat/completions 或 https://api.anthropic.com/v1/messages"
            />
          </div>

          <div>
            <label htmlFor="llm-form-apikey" className="mb-1 block text-sm font-medium text-gray-700">
              API key
            </label>
            <input
              id="llm-form-apikey"
              type="password"
              className={inputClass}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={mode === 'edit' ? '留空表示不修改' : 'sk-...'}
              autoComplete="new-password"
            />
            {mode === 'edit' && provider?.hasApiKey ? (
              <p className="mt-1 text-xs text-gray-500">当前 key：{provider.apiKeyHint ?? '已设置'}，留空表示不修改。</p>
            ) : null}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">模型列表</span>
              <Button
                type="button"
                variant="ghost"
                className="px-2 py-1 text-xs"
                onClick={() => setRows((prev) => [...prev, { name: '', contextLength: '128000', maxOutputTokens: '' }])}
                disabled={rows.length >= 20}
              >
                添加模型
              </Button>
            </div>
            <div className="space-y-2">
              {rows.map((row, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    aria-label={`模型名 ${index + 1}`}
                    className={`${inputClass} min-w-40 flex-1`}
                    value={row.name}
                    onChange={(e) => updateRow(index, { name: e.target.value })}
                    placeholder="模型名"
                  />
                  <input
                    type="number"
                    aria-label={`上下文长度 ${index + 1}`}
                    className={`${inputClass} w-32`}
                    value={row.contextLength}
                    onChange={(e) => updateRow(index, { contextLength: e.target.value })}
                    placeholder="上下文长度"
                  />
                  <input
                    type="number"
                    aria-label={`最大输出 ${index + 1}`}
                    className={`${inputClass} w-32`}
                    value={row.maxOutputTokens}
                    onChange={(e) => updateRow(index, { maxOutputTokens: e.target.value })}
                    placeholder="最大输出（可选）"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    onClick={() => removeRow(index)}
                    disabled={rows.length <= 1}
                  >
                    删除
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            启用该供应商
          </label>

          <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
            <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
