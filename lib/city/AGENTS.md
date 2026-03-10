# CITY DOMAIN

## OVERVIEW
`lib/city/` manages city and area data — hierarchical geographic taxonomy, name normalization, slug generation, and article-city linking for pilgrimage locations. 12 files, 762 lines.

## STRUCTURE
```text
lib/city/
|- types.ts          # City/area type definitions and hierarchy
|- normalize.ts      # Name normalization and slug generation
|- repo*.ts          # City persistence and queries
|- queries.ts        # Complex city/area query utilities
|- adminPanel.ts     # Admin panel data aggregation
`- seed.ts           # City data seeding utilities
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| City/area hierarchy | `types.ts` | Geographic taxonomy definitions |
| Name normalization | `normalize.ts` | Slug generation and name cleanup |
| Admin city editing | `adminPanel.ts` | Data for `admin/panel/city/[id]` UI |
| City seeding | `seed.ts` + `scripts/city-seed.js` | Initial data population |

## CONVENTIONS
- City names require normalization before storage — use `normalize.ts` helpers.
- Area hierarchy is tree-structured (city → area → sub-area).
- City slugs must be unique; check via repo before creating.

## ANTI-PATTERNS
- Do not bypass `normalize.ts` when creating/updating city names.
- Do not flatten the area hierarchy — preserve parent-child relationships.
