import type { SpokeMode } from './types'

type RequestInitLite = {
  method?: string
  body?: unknown
}

type WorkflowRun = {
  id: number
  html_url: string
  status: string
  conclusion: string | null
  created_at: string
  updated_at: string
  display_title?: string
  name?: string
  event?: string
  actor?: { login?: string | null } | null
  head_branch?: string | null
  pull_requests?: Array<{ html_url?: string | null }>
}

type WorkflowArtifact = {
  id: number
  name: string
  size_in_bytes: number
  expired: boolean
  archive_download_url: string
}

const GITHUB_API_BASE = 'https://api.github.com'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = String(repo || '').split('/').map((x) => x.trim())
  if (!owner || !name) {
    throw new Error('Invalid SEO_AUTOMATION_REPO, expected owner/repo')
  }
  return { owner, name }
}

export type SpokeGithubConfig = {
  token: string
  repo: string
  workflowFile: string
  baseBranch: string
}

export function getSpokeGithubConfigFromEnv(): SpokeGithubConfig {
  const token = String(process.env.SEO_AUTOMATION_GITHUB_TOKEN || '').trim()
  const repo = String(process.env.SEO_AUTOMATION_REPO || '').trim()
  const workflowFile = String(process.env.SEO_AUTOMATION_WORKFLOW_FILE || 'seo-spoke-factory.yml').trim()
  const baseBranch = String(process.env.SEO_AUTOMATION_BASE_BRANCH || 'main').trim()

  if (!token) {
    throw new Error('Missing SEO_AUTOMATION_GITHUB_TOKEN')
  }
  if (!repo) {
    throw new Error('Missing SEO_AUTOMATION_REPO')
  }
  parseRepo(repo)

  return { token, repo, workflowFile, baseBranch }
}

export class SpokeGithubClient {
  private readonly token: string
  private readonly owner: string
  private readonly repo: string

  constructor(config: { token: string; repo: string }) {
    const parsed = parseRepo(config.repo)
    this.token = config.token
    this.owner = parsed.owner
    this.repo = parsed.name
  }

  private async request<T>(path: string, init?: RequestInitLite): Promise<T> {
    const response = await fetch(`${GITHUB_API_BASE}${path}`, {
      method: init?.method || 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'seichigo-seo-spoke-factory',
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`GitHub API ${response.status}: ${text || response.statusText}`)
    }

    if (response.status === 204) {
      return undefined as T
    }

    return (await response.json()) as T
  }

  async dispatchWorkflow(workflowFile: string, ref: string, inputs: Record<string, string>): Promise<void> {
    await this.request<void>(`/repos/${this.owner}/${this.repo}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`, {
      method: 'POST',
      body: { ref, inputs },
    })
  }

  async listWorkflowRuns(workflowFile: string, perPage = 20): Promise<WorkflowRun[]> {
    const data = await this.request<{ workflow_runs: WorkflowRun[] }>(
      `/repos/${this.owner}/${this.repo}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?per_page=${Math.max(
        1,
        Math.min(100, perPage)
      )}`
    )
    return Array.isArray(data.workflow_runs) ? data.workflow_runs : []
  }

  async getWorkflowRun(runId: number): Promise<WorkflowRun> {
    return await this.request<WorkflowRun>(`/repos/${this.owner}/${this.repo}/actions/runs/${runId}`)
  }

  async listRunArtifacts(runId: number): Promise<WorkflowArtifact[]> {
    const data = await this.request<{ artifacts: WorkflowArtifact[] }>(
      `/repos/${this.owner}/${this.repo}/actions/runs/${runId}/artifacts?per_page=100`
    )
    return Array.isArray(data.artifacts) ? data.artifacts : []
  }

  async downloadArtifactZip(artifactId: number): Promise<Buffer> {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/actions/artifacts/${artifactId}/zip`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'seichigo-seo-spoke-factory',
        },
      }
    )
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Artifact download failed (${response.status}): ${text || response.statusText}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  async dispatchAndResolveRun(args: {
    workflowFile: string
    ref: string
    inputs: Record<string, string>
    timeoutMs?: number
  }): Promise<{ runId: number; runUrl: string }> {
    const timeoutMs = args.timeoutMs ?? 30000
    const before = await this.listWorkflowRuns(args.workflowFile, 20)
    const beforeIds = new Set(before.map((run) => run.id))

    await this.dispatchWorkflow(args.workflowFile, args.ref, args.inputs)

    const startedAt = Date.now()
    while (Date.now() - startedAt <= timeoutMs) {
      const runs = await this.listWorkflowRuns(args.workflowFile, 20).catch(() => [])
      const found = runs.find((run) => !beforeIds.has(run.id))
      if (found) {
        return { runId: found.id, runUrl: found.html_url }
      }
      await sleep(1500)
    }

    const latest = await this.listWorkflowRuns(args.workflowFile, 1)
    const fallback = latest[0]
    if (fallback) {
      return { runId: fallback.id, runUrl: fallback.html_url }
    }
    throw new Error('Workflow dispatched but no run id could be resolved')
  }
}

export function parseModeFromRun(run: { display_title?: string; name?: string }): SpokeMode | null {
  const text = `${run.display_title || ''} ${run.name || ''}`.toLowerCase()
  if (text.includes('preview')) return 'preview'
  if (text.includes('generate')) return 'generate'
  return null
}

