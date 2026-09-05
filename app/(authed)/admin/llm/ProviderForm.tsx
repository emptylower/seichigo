'use client'

import { useState } from 'react'
import Button from '@/components/shared/Button'
import type { LlmProtocol, LlmProviderView } from './types'
import { normalizeEndpointUrl, validateProviderValues, type ProviderFormValues } from './validation'

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

/** 拉取结果合并进行列表：已存在的行保留用户填的上下文长度；新行用返回值或 128000；丢弃未填名的占位行 */
function mergeDiscoveredModels(
  rows: ModelRow[],
  models: Array<{ name: string; contextLength: number | null }>,
): ModelRow[] {
  const next = rows.filter((row) => row.name.trim())
  const names = new Set(next.map((row) => row.name.trim()))
  for (const model of models) {
    if (names.has(model.name)) continue
    if (next.length >= 20) break
    names.add(model.name)
    next.push({ name: model.name, contextLength: String(model.contextLength ?? 128000), maxOutputTokens: '' })
  }
  return next.length ? next : [{ name: '', contextLength: '128000', maxOutputTokens: '' }]
}

/** 新建态本地预览归一后的请求 URL（编辑态展示服务端视图里的 endpointUrl） */
function localEndpointPreview(protocol: LlmProtocol, baseUrl: string): string | null {
  const trimmed = baseUrl.trim()
  if (!trimmed) return null
  try {
    new URL(trimmed)
  } catch {
    return null
  }
  return normalizeEndpointUrl(protocol, trimmed)
}

export default function ProviderForm({ mode, provider, saving, serverError, onCancel, onSubmit }: ProviderFormProps) {
  const [name, setName] = useState(provider?.name ?? '')
  const [protocol, setProtocol] = useState<LlmProtocol>(provider?.protocol ?? 'openai')
  // 基地址：编辑态回填 baseUrl（旧视图缺省时回退 endpointUrl，归一后同值）
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? provider?.endpointUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [enabled, setEnabled] = useState(provider?.enabled ?? true)
  const [rows, setRows] = useState<ModelRow[]>(() => rowsFromProvider(provider))
  const [localError, setLocalError] = useState<string | null>(null)
  // 拉取模型列表：discovering=请求中；discoverNote=结果提示（成功/失败）
  const [discovering, setDiscovering] = useState(false)
  const [discoverNote, setDiscoverNote] = useState<{ ok: boolean; text: string } | null>(null)

  const error = localError ?? serverError

  // 拉取模型需要 key：新建态用表单里的 key；编辑态用服务端已保存的 key（也可新填覆盖）
  const discoverKeyMissing = mode === 'create' ? !apiKey.trim() : !apiKey.trim() && !provider?.hasApiKey
  const canDiscover = Boolean(baseUrl.trim()) && !discoverKeyMissing && !discovering
  const endpointPreview =
    mode === 'edit' && provider ? provider.endpointUrl : localEndpointPreview(protocol, baseUrl)

  function updateRow(index: number, patch: Partial<ModelRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function removeRow(index: number) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))
  }

  /** 拉取模型列表（§0.4）：成功合并进行列表并提示数量；失败显示脱敏后的 message */
  async function handleDiscover() {
    if (!canDiscover) return
    setDiscovering(true)
    setDiscoverNote(null)
    try {
      const res = await fetch('/api/admin/llm/providers/discover-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: baseUrl.trim(),
          protocol,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(mode === 'edit' && provider ? { providerId: provider.id } : {}),
        }),
      })
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean
        models?: Array<{ name?: unknown; contextLength?: unknown }>
        message?: string
      } | null
      if (!res.ok || !data) {
        setDiscoverNote({ ok: false, text: '拉取失败，请稍后再试' })
        return
      }
      if (data.ok !== true) {
        setDiscoverNote({ ok: false, text: data.message ?? '拉取失败' })
        return
      }
      const models = (Array.isArray(data.models) ? data.models : [])
        .map((m) => ({
          name: String(m?.name ?? '').trim(),
          contextLength: typeof m?.contextLength === 'number' && Number.isFinite(m.contextLength) ? m.contextLength : null,
        }))
        .filter((m) => m.name)
      setRows((prev) => mergeDiscoveredModels(prev, models))
      setDiscoverNote({ ok: true, text: `已拉取 ${models.length} 个模型` })
    } catch {
      setDiscoverNote({ ok: false, text: '网络错误，拉取失败' })
    } finally {
      setDiscovering(false)
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const values: ProviderFormValues = {
      name,
      protocol,
      baseUrl,
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
              接口地址
            </label>
            <input
              id="llm-form-endpoint"
              type="text"
              className={inputClass}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://your-sub2api.example.com/v1"
            />
            <p className="mt-1 text-xs text-gray-500">
              填基地址即可，如 https://your-sub2api.example.com/v1，系统自动补全 /chat/completions 或 /v1/messages
            </p>
            {endpointPreview ? (
              <p className="mt-1 break-all text-xs text-gray-500">
                请求 URL：<span className="font-mono">{endpointPreview}</span>
              </p>
            ) : null}
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
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  onClick={() => void handleDiscover()}
                  disabled={!canDiscover}
                >
                  {discovering ? '拉取中…' : '拉取模型列表'}
                </Button>
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
            </div>
            {discoverKeyMissing ? (
              <p className="mb-1 text-xs text-gray-400">填写 API key 后可一键拉取可用模型{mode === 'edit' ? '（已保存 key 的供应商可直接拉取）' : ''}</p>
            ) : null}
            {discoverNote ? (
              <p className={`mb-1 text-xs ${discoverNote.ok ? 'text-emerald-600' : 'text-rose-600'}`} role="status">
                {discoverNote.text}
              </p>
            ) : null}
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
