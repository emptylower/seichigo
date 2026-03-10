# TRANSLATION DOMAIN

## OVERVIEW
`lib/translation` owns task enqueue/execution, Gemini integration, TipTap text extraction/rewrite, and admin dashboard aggregation. Largest domain by lines (33 files, 6023 lines, 18 handlers).

## STRUCTURE
```text
lib/translation/
|- api.ts             # getTranslationApiDeps wiring
|- handlers/          # 18 handlers (tasks, batch, execute, backfill, approve,
|                     #   mapOps, mapSummary, stats, untranslated, pendingCount,
|                     #   taskById/Approve/Translate/Rollback/History/UpdatePublished,
|                     #   articleTranslations, approveBatch)
|- service.ts         # Core task orchestration
|- gemini.ts          # Model client + request execution
|- tiptap.ts          # TipTap JSON text extraction/patch helpers
|- mapTaskEnqueue.ts  # Map-specific task creation
|- mapTaskExecutor.ts # Map task batch execution
|- mapOps.ts          # Map translation ops (699 lines, hotspot)
|- adminApproval.ts   # Approval batch workflow (787 lines, hotspot)
|- adminCoverage.ts   # Coverage report generation (618 lines, hotspot)
`- adminDashboard.ts  # Metrics aggregation (503 lines)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| API dependency wiring | `api.ts` | Keep deps centralized; avoid per-handler ad-hoc imports |
| Batch task execution | `service.ts`, `mapTaskExecutor.ts` | Concurrency/retry-sensitive |
| Model request behavior | `gemini.ts` | Keep API shape + fallback behavior stable |
| TipTap translation safety | `tiptap.ts` | Must preserve document structure while replacing text nodes |
| Map translation ops | `mapOps.ts` | 699-line hotspot; separate from article translation flow |
| Approval workflow | `adminApproval.ts` | 787-line hotspot; batch publish orchestration |
| Coverage reports | `adminCoverage.ts` | 618-line hotspot; translation gap analysis |
| Admin metrics/dashboard | `adminDashboard.ts`, `handlers/stats.ts` | Avoid expensive unbounded queries |

## CONVENTIONS
- Keep enqueue and execute paths idempotent; tasks may be retried or resumed.
- Preserve status transitions (`pending` -> `processing` -> `ready/failed`) with explicit timestamps/errors.
- Keep map translation flow separate from article flow when fields, batching, or validators differ.
- Treat TipTap transforms as structure-preserving operations; replace text content, not node semantics.

## ANTI-PATTERNS
- Do not inline Gemini calls in route wrappers or UI code.
- Do not mutate task status without corresponding audit fields/error context.
- Do not bypass `tiptap.ts` helpers with string-based HTML hacks.
- Do not run large backfills without bounded batch size and clear progress accounting.

## COMMANDS
```bash
npm test -- tests/translation
npm test -- tests/admin/translation-integration.test.ts
npx vitest run --project node -- tests/translation/service.test.ts
```
