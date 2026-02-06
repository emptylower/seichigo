export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { extractSummaryFromZipBuffer } from '@/lib/seo/spokeFactory/artifact'
import { SpokeGithubClient, getSpokeGithubConfigFromEnv, parseModeFromRun } from '@/lib/seo/spokeFactory/github'

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { id } = await ctx.params
    const runId = Number.parseInt(String(id || ''), 10)
    if (!Number.isFinite(runId) || runId <= 0) {
      return NextResponse.json({ error: 'Invalid run id' }, { status: 400 })
    }

    const config = getSpokeGithubConfigFromEnv()
    const client = new SpokeGithubClient({ token: config.token, repo: config.repo })
    const run = await client.getWorkflowRun(runId)
    const artifacts = await client.listRunArtifacts(runId)

    const summaryArtifact = artifacts.find((artifact) => artifact.name === 'seo-spoke-factory-summary' && !artifact.expired)
    let summary: Record<string, unknown> | null = null
    if (summaryArtifact) {
      const zipBuffer = await client.downloadArtifactZip(summaryArtifact.id).catch(() => null)
      if (zipBuffer) {
        const parsed = await extractSummaryFromZipBuffer(zipBuffer)
        if (parsed) summary = parsed as unknown as Record<string, unknown>
      }
    }

    const prUrlFromRun = Array.isArray(run.pull_requests) ? run.pull_requests.find((pr) => pr?.html_url)?.html_url || null : null
    const prUrlFromSummary =
      summary && typeof summary.prUrl === 'string' && summary.prUrl.trim() ? String(summary.prUrl) : null

    return NextResponse.json({
      runId: run.id,
      status: run.status,
      conclusion: run.conclusion,
      mode: parseModeFromRun(run),
      htmlUrl: run.html_url,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      prUrl: prUrlFromSummary || prUrlFromRun,
      summary,
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id,
        name: artifact.name,
        sizeInBytes: artifact.size_in_bytes,
        expired: artifact.expired,
      })),
    })
  } catch (error) {
    console.error('[api/admin/seo/spoke-factory/runs/[id]] GET failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load run detail' },
      { status: 500 }
    )
  }
}

