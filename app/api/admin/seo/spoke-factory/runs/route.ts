export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { SpokeGithubClient, getSpokeGithubConfigFromEnv, parseModeFromRun } from '@/lib/seo/spokeFactory/github'

export async function GET(request: Request) {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const url = new URL(request.url)
    const rawLimit = Number.parseInt(url.searchParams.get('limit') || '20', 10)
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, rawLimit)) : 20

    const config = getSpokeGithubConfigFromEnv()
    const client = new SpokeGithubClient({ token: config.token, repo: config.repo })
    const runs = await client.listWorkflowRuns(config.workflowFile, limit)

    return NextResponse.json({
      runs: runs.slice(0, limit).map((run) => ({
        runId: run.id,
        status: run.status,
        conclusion: run.conclusion,
        mode: parseModeFromRun(run),
        htmlUrl: run.html_url,
        prUrl: Array.isArray(run.pull_requests) ? run.pull_requests.find((pr) => pr?.html_url)?.html_url || null : null,
        createdAt: run.created_at,
        updatedAt: run.updated_at,
        actor: run.actor?.login ?? null,
        headBranch: run.head_branch ?? null,
      })),
    })
  } catch (error) {
    console.error('[api/admin/seo/spoke-factory/runs] GET failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load runs' },
      { status: 500 }
    )
  }
}
