# ARTICLE DOMAIN

## OVERVIEW
`lib/article` owns article lifecycle logic, repository contracts, workflow states, and API dependency wiring.

## STRUCTURE
```text
lib/article/
|- api.ts                # getArticleApiDeps factory
|- handlers/             # 10 handler files split by role:
|  |- articles.ts / articleById.ts     # Main CRUD
|  |- submit.ts / withdraw.ts          # Author workflow
|  |- adminApprove/Reject/Unpublish.ts # Admin moderation
|  `- adminReviewList/Article/ArticlesList.ts  # Admin queries
|- workflow.ts           # lifecycle and WorkflowResult types
|- repo*.ts              # repo contracts + implementations
`- slug.ts / repair*.ts  # slug generation and data repair helpers
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add API behavior | `lib/article/handlers/*.ts` | Split by user/admin action |
| Dependency wiring | `lib/article/api.ts` | Lazy import + cached deps |
| Status transitions | `lib/article/workflow.ts` | Domain state machine and result union |
| Persistence updates | `lib/article/repo.ts`, `repoPrisma.ts` | Keep interface and implementation aligned |
| Test doubles | `lib/article/repoMemory.ts` | Prefer for node-unit tests |

## CONVENTIONS
- Keep handlers focused on request orchestration + validation + response shape.
- Reuse `ArticleApiDeps`; avoid ad-hoc imports inside handlers.
- Return explicit, user-safe error payloads/statuses consistent with existing handlers.
- Treat slug generation and uniqueness checks as part of create/update invariants.

## ANTI-PATTERNS
- Do not instantiate Prisma directly in handlers.
- Do not collapse admin and author flows into one oversized handler.
- Do not throw opaque errors when `WorkflowResult`/typed outcomes exist.
- Do not bypass HTML sanitization on article rich-text fields.

## NOTES
- Article **revisions** are a separate domain in `lib/articleRevision/` — do not conflate.
- 18 files, 1863 lines. Handlers split by user vs admin action.
