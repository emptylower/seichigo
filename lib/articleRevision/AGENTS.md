# ARTICLE REVISION DOMAIN

## OVERVIEW
`lib/articleRevision/` manages article revision lifecycle — a **separate domain** from `lib/article/`. Handles revision submission, review, approval, and rejection. 12 files, 1016 lines.

## STRUCTURE
```text
lib/articleRevision/
|- api.ts                   # getArticleRevisionApiDeps factory
|- handlers/
|  |- submit.ts             # Author submits revision
|  |- withdraw.ts           # Author withdraws revision
|  |- adminApprove.ts       # Admin approves revision
|  |- adminReject.ts        # Admin rejects revision
|  |- revisionById.ts       # Revision detail retrieval (53 lines of internal helpers)
|  |- adminReviewList.ts    # Admin review queue for revisions
|  `- createFromArticle.ts  # Fork existing article into revision
|- repo.ts                  # ArticleRevisionRepo interface
|- repoPrisma.ts            # Prisma implementation
`- repoMemory.ts            # In-memory test double
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Submit a revision | `handlers/submit.ts` | Author-facing submission flow |
| Review revisions | `handlers/adminReviewList.ts` | Admin queue, separate from article review |
| Approve/reject | `handlers/adminApprove.ts`, `adminReject.ts` | Admin moderation |
| Create from article | `handlers/createFromArticle.ts` | Fork existing article into revision |

## CONVENTIONS
- Revision lifecycle is independent of article lifecycle — separate review queues.
- Follows standard domain pattern: `api.ts` → `handlers/` → `repo*.ts`.

## ANTI-PATTERNS
- Do not conflate revision handlers with article handlers — they are separate domains.
- Do not bypass the revision review queue by directly applying changes to articles.
