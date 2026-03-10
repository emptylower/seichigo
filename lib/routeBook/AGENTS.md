# ROUTE BOOK DOMAIN

## OVERVIEW
`lib/routeBook/` manages user-curated pilgrimage route collections — ordered sequences of Anitabi points that users can create, share, and follow. 6 files, 1091 lines.

## STRUCTURE
```text
lib/routeBook/
|- api.ts                    # getRouteBookApiDeps factory
|- handlers/
|  |- routebooks.ts          # CRUD for route book collections
|  `- routebookPoints.ts     # Point ordering within a route book
|- repo.ts                   # RouteBookRepo interface
|- repoPrisma.ts             # Prisma implementation
`- repoMemory.ts             # In-memory test double
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Route book CRUD | `handlers/routebooks.ts` | Create, list, update, delete collections |
| Point management | `handlers/routebookPoints.ts` | Add/remove/reorder points in a book |
| UI integration | `app/(authed)/me/routebooks/[id]/` | User-facing detail (594-line hook) |
| Tests | `tests/routeBook/utils.test.ts` | 596 lines; comprehensive point ordering tests |

## CONVENTIONS
- Points are ordered sequences — maintain sort order integrity.
- Route books belong to authenticated users; enforce ownership in handlers.

## ANTI-PATTERNS
- Do not allow cross-user route book modification without explicit sharing model.
- Do not bypass point ordering when adding/removing entries.
