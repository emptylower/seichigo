# OPS DOMAIN

## OVERVIEW
`lib/ops/` provides operational health monitoring — Vercel log fetching, regex-based classification, and markdown report generation on a daily cron. 6 files, 1510 lines.

## STRUCTURE
```text
lib/ops/
|- api.ts                # getOpsApiDeps factory
|- reportWorkflow.ts     # Report generation workflow (613 lines, hotspot)
|- logClassifier.ts      # Regex-based log severity classification
|- handlers/
|  |- cronDaily.ts       # Daily cron job handler
|  `- reports.ts         # Report retrieval handlers
`- repo*.ts              # OpsReport/OpsLogEvent persistence
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Daily cron behavior | `handlers/cronDaily.ts` | Triggered by vercel.json at 00:00 UTC |
| Log classification rules | `logClassifier.ts` | WARNING_MESSAGE_PATTERNS and severity levels |
| Report generation | `reportWorkflow.ts` | Fetches Vercel logs, classifies, generates markdown |
| Report storage | `repoPrisma.ts` | OpsReport + OpsLogEvent Prisma models |

## CONVENTIONS
- Log classification uses regex patterns for severe (panic, OOM, timeout) vs warning levels.
- Reports are stored in DB as structured records with markdown body.
- Cron endpoint validates secret via Authorization header.

## ANTI-PATTERNS
- Do not hardcode Vercel API URLs; use env-driven configuration.
- Do not run unbounded log fetches; respect pagination and time windows.
- Do not skip severity classification when adding new log patterns.
