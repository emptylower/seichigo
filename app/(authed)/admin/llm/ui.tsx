'use client'

import { useCallback, useEffect, useState } from 'react'
import Button from '@/components/shared/Button'
import { AdminEmptyState } from '@/components/admin/state/AdminEmptyState'
import { AdminErrorState } from '@/components/admin/state/AdminErrorState'
import { AdminSkeleton } from '@/components/admin/state/AdminSkeleton'
import { useAdminConfirm } from '@/hooks/useAdminConfirm'
import ProviderForm from './ProviderForm'
import type { LlmProviderView, LlmProvidersResponse, LlmTestResult } from './types'
import type { ProviderFormValues } from './validation'

type ScopeKey = 'agent' | 'translation'
type DialogState = { mode: 'create' } | { mode: 'edit'; provider: LlmProviderView } | null
type EffectiveState = LlmProvidersResponse['effective']
type TestState =
  | { status: 'testing' }
  | { status: 'done'; result: LlmTestResult }

const SCOPE_LABEL: Record<ScopeKey, string> = { agent: 'Agent', translation: '翻译' }
const SCOPE_MODEL_FIELD: Record<ScopeKey, 'agentModel' | 'translationModel'> = {
  agent: 'agentModel',
  translation: 'translationModel',
}

function protocolLabel(protocol: LlmProviderView['protocol']): string {
  return protocol === 'openai' ? 'OpenAI 兼容' : 'Anthropic'
}

async function readError(res: Response, fallback: string): Promise<Error> {
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  return new Error(data.error || fallback)
}

function TakeoverControl({
  provider,
  scope,
  busy,
  onToggle,
  onModelChange,
}: {
  provider: LlmProviderView
  scope: ScopeKey
  busy: boolean
  onToggle: (scope: ScopeKey, checked: boolean) => void
  onModelChange: (scope: ScopeKey, model: string) => void
}) {
  const label = scope === 'agent' ? '接管 Agent' : '接管翻译'
  const checked = provider.takeover[scope]
  const currentModel = provider[SCOPE_MODEL_FIELD[scope]] ?? provider.models[0]?.name ?? ''
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={checked} disabled={busy} onChange={(e) => onToggle(scope, e.target.checked)} />
        {label}
      </label>
      {checked ? (
        <select
          aria-label={`${SCOPE_LABEL[scope]}模型`}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          value={currentModel}
          disabled={busy}
          onChange={(e) => onModelChange(scope, e.target.value)}
        >
          {provider.models.map((model) => (
            <option key={model.name} value={model.name}>
              {model.name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  )
}

function ProviderCard({
  provider,
  testStates,
  busy,
  onTest,
  onToggleTakeover,
  onTakeoverModelChange,
  onEdit,
  onDelete,
}: {
  provider: LlmProviderView
  testStates: Record<string, TestState>
  busy: boolean
  onTest: (provider: LlmProviderView, model: string) => void
  onToggleTakeover: (provider: LlmProviderView, scope: ScopeKey, checked: boolean) => void
  onTakeoverModelChange: (provider: LlmProviderView, scope: ScopeKey, model: string) => void
  onEdit: (provider: LlmProviderView) => void
  onDelete: (provider: LlmProviderView) => void
}) {
  return (
    <section data-testid={`llm-provider-${provider.id}`} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900">{provider.name}</h3>
            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
              {protocolLabel(provider.protocol)}
            </span>
            {provider.source === 'env' ? (
              <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">内置</span>
            ) : null}
            {!provider.enabled ? (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">已停用</span>
            ) : null}
          </div>
          <p className="break-all font-mono text-xs text-gray-500">{provider.baseUrl}</p>
          <p
            className="break-all font-mono text-[11px] text-gray-400"
            title={`归一后的请求 URL：${provider.endpointUrl}`}
          >
            {provider.endpointUrl}
          </p>
          <p className="text-xs text-gray-500">API key：{provider.apiKeyHint ?? '未设置'}</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => onEdit(provider)} disabled={busy}>
            编辑
          </Button>
          <Button type="button" variant="ghost" className="text-rose-700" onClick={() => onDelete(provider)} disabled={busy}>
            删除
          </Button>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
              <th className="py-2 pr-4 font-medium">模型名</th>
              <th className="py-2 pr-4 font-medium">上下文长度</th>
              <th className="py-2 pr-4 font-medium">最大输出</th>
              <th className="py-2 font-medium">连接测试</th>
            </tr>
          </thead>
          <tbody>
            {provider.models.map((model) => {
              const state = testStates[`${provider.id}:${model.name}`]
              const testing = state?.status === 'testing'
              return (
                <tr key={model.name} className="border-b border-gray-50 last:border-0">
                  <td className="py-2 pr-4 font-mono text-gray-900">{model.name}</td>
                  <td className="py-2 pr-4 text-gray-700">{model.contextLength}</td>
                  <td className="py-2 pr-4 text-gray-700">{model.maxOutputTokens ?? '默认'}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        disabled={busy || testing}
                        onClick={() => onTest(provider, model.name)}
                      >
                        {testing ? '测试中…' : '测试'}
                      </Button>
                      {state?.status === 'done' ? (
                        state.result.ok ? (
                          <span className="text-xs text-emerald-700">
                            {state.result.latencyMs !== null ? `${state.result.latencyMs} ms` : '连接正常'}
                          </span>
                        ) : (
                          <span className="text-xs text-rose-700">{state.result.message || '连接失败'}</span>
                        )
                      ) : null}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
        <TakeoverControl provider={provider} scope="agent" busy={busy} onToggle={(s, c) => onToggleTakeover(provider, s, c)} onModelChange={(s, m) => onTakeoverModelChange(provider, s, m)} />
        <TakeoverControl provider={provider} scope="translation" busy={busy} onToggle={(s, c) => onToggleTakeover(provider, s, c)} onModelChange={(s, m) => onTakeoverModelChange(provider, s, m)} />
      </div>
    </section>
  )
}

export default function AdminLlmClient() {
  const askForConfirm = useAdminConfirm()
  const [providers, setProviders] = useState<LlmProviderView[]>([])
  const [effective, setEffective] = useState<EffectiveState>({ agent: null, translation: null })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [testStates, setTestStates] = useState<Record<string, TestState>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/admin/llm/providers', { method: 'GET' })
      const data = (await res.json().catch(() => ({}))) as Partial<LlmProvidersResponse> & { error?: string }
      if (!res.ok || data.error) throw new Error(data.error || '加载供应商列表失败')
      setProviders(data.providers || [])
      setEffective(data.effective || { agent: null, translation: null })
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '加载供应商列表失败')
      setProviders([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function updateProvider(id: string, patch: Record<string, unknown>) {
    setBusy(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/admin/llm/providers/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw await readError(res, '更新供应商失败')
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '更新供应商失败')
    } finally {
      setBusy(false)
    }
  }

  function handleToggleTakeover(provider: LlmProviderView, scope: ScopeKey, checked: boolean) {
    const patch: Record<string, unknown> = { takeover: { [scope]: checked } }
    if (checked) {
      const model = provider[SCOPE_MODEL_FIELD[scope]] ?? provider.models[0]?.name
      if (model) patch[SCOPE_MODEL_FIELD[scope]] = model
    }
    void updateProvider(provider.id, patch)
  }

  function handleTakeoverModelChange(provider: LlmProviderView, scope: ScopeKey, model: string) {
    void updateProvider(provider.id, { [SCOPE_MODEL_FIELD[scope]]: model })
  }

  async function handleTest(provider: LlmProviderView, model: string) {
    const key = `${provider.id}:${model}`
    setTestStates((prev) => ({ ...prev, [key]: { status: 'testing' } }))
    try {
      const res = await fetch(`/api/admin/llm/providers/${encodeURIComponent(provider.id)}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      })
      if (!res.ok) throw await readError(res, '测试请求失败')
      const data = (await res.json().catch(() => ({}))) as { result?: LlmTestResult }
      const result = data.result ?? { ok: false, latencyMs: null, message: '测试响应格式异常' }
      setTestStates((prev) => ({ ...prev, [key]: { status: 'done', result } }))
    } catch (err) {
      setTestStates((prev) => ({
        ...prev,
        [key]: { status: 'done', result: { ok: false, latencyMs: null, message: err instanceof Error ? err.message : '测试请求失败' } },
      }))
    }
  }

  async function handleDelete(provider: LlmProviderView) {
    const confirmed = await askForConfirm({
      title: `删除供应商「${provider.name}」`,
      description:
        provider.source === 'env'
          ? '该供应商为内置供应商，删除后需要重新内化。删除操作无法撤销。'
          : '删除后无法撤销。若该供应商正在接管 Agent 或翻译，对应范围将回退到环境变量。',
      confirmLabel: '确认删除',
      tone: 'danger',
    })
    if (!confirmed) return
    setBusy(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/admin/llm/providers/${encodeURIComponent(provider.id)}`, { method: 'DELETE' })
      if (!res.ok) throw await readError(res, '删除供应商失败')
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '删除供应商失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmit(values: ProviderFormValues) {
    if (!dialog) return
    setSaving(true)
    setFormError(null)
    try {
      const body: Record<string, unknown> = {
        name: values.name.trim(),
        protocol: values.protocol,
        // §0.3：提交基地址，服务端归一为完整请求 URL（endpointUrl 仅兼容旧客户端）
        baseUrl: values.baseUrl.trim(),
        enabled: values.enabled,
        models: values.models.map((m) => ({
          name: m.name.trim(),
          contextLength: m.contextLength,
          maxOutputTokens: m.maxOutputTokens ?? null,
        })),
      }
      if (values.apiKey.trim()) body.apiKey = values.apiKey.trim()
      const isEdit = dialog.mode === 'edit'
      const url = isEdit
        ? `/api/admin/llm/providers/${encodeURIComponent(dialog.provider.id)}`
        : '/api/admin/llm/providers'
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw await readError(res, '保存供应商失败')
      setDialog(null)
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存供应商失败')
    } finally {
      setSaving(false)
    }
  }

  function effectiveLabel(scope: ScopeKey): string {
    const current = effective[scope]
    if (!current) return '环境变量'
    const provider = providers.find((p) => p.id === current.providerId)
    return `${provider?.name ?? current.providerId} · ${current.model}`
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">模型接入</h1>
          <p className="mt-1 text-sm text-gray-600">管理自定义 LLM 供应商及其接管范围。</p>
        </div>
        <Button type="button" onClick={() => { setFormError(null); setDialog({ mode: 'create' }) }} disabled={busy}>
          新建供应商
        </Button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">当前接管</h2>
        <div className="mt-2 grid gap-2 text-sm text-gray-700 sm:grid-cols-2">
          <div>
            <span className="font-medium text-gray-600">Agent：</span>
            {effectiveLabel('agent')}
          </div>
          <div>
            <span className="font-medium text-gray-600">翻译：</span>
            {effectiveLabel('translation')}
          </div>
        </div>
      </div>

      {actionError ? (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {actionError}
        </div>
      ) : null}

      {loading ? <AdminSkeleton rows={6} /> : null}
      {!loading && loadError ? <AdminErrorState message={loadError} onRetry={() => void load()} /> : null}
      {!loading && !loadError && providers.length === 0 ? (
        <AdminEmptyState title="暂无供应商" description="点击右上角「新建供应商」添加自定义 LLM 供应商。" />
      ) : null}
      {!loading && !loadError
        ? providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              testStates={testStates}
              busy={busy}
              onTest={(p, m) => void handleTest(p, m)}
              onToggleTakeover={handleToggleTakeover}
              onTakeoverModelChange={handleTakeoverModelChange}
              onEdit={(p) => { setFormError(null); setDialog({ mode: 'edit', provider: p }) }}
              onDelete={(p) => void handleDelete(p)}
            />
          ))
        : null}

      {dialog ? (
        <ProviderForm
          mode={dialog.mode}
          provider={dialog.mode === 'edit' ? dialog.provider : undefined}
          saving={saving}
          serverError={formError}
          onCancel={() => setDialog(null)}
          onSubmit={(values) => void handleSubmit(values)}
        />
      ) : null}
    </div>
  )
}
