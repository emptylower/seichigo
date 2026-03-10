# COMMENT DOMAIN

## OVERVIEW
`lib/comment/` implements the comment system with repository pattern, markdown rendering, and like functionality. 8 files, 499 lines.

## STRUCTURE
```text
lib/comment/
|- api.ts              # getCommentApiDeps factory (sync, not async)
|- handlers/
|  |- comments.ts      # List/create comments with pagination
|  |- commentById.ts   # Single comment operations
|  `- commentLike.ts   # Like/unlike toggle
|- repo.ts             # CommentRepo interface
|- repoPrisma.ts       # Prisma implementation
|- repoMemory.ts       # In-memory test double
`- markdown.ts         # Comment markdown rendering
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Create/list comments | `handlers/comments.ts` | Main CRUD with pagination |
| Like behavior | `handlers/commentLike.ts` | Toggle like/unlike |
| Markdown rendering | `markdown.ts` | Renders user comment markdown safely |
| Test doubles | `repoMemory.ts` | Deterministic testing without DB |

## CONVENTIONS
- `getCommentApiDeps` is **synchronous** (not async) — unlike most other domain factories.
- Comment markdown rendering is separate from rich-text sanitization (different pipeline).

## ANTI-PATTERNS
- Do not use rich-text sanitizer for comments — they use markdown, not HTML.
- Do not add direct Prisma queries in handlers; use the repo interface.
