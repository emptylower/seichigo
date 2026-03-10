# AI CONTENT DOMAIN

## OVERVIEW
`lib/ai/` handles AI-assisted article creation and import — content generation, article scaffolding, and asset management for AI-produced content. 9 files, 709 lines.

## STRUCTURE
```text
lib/ai/
|- api.ts              # getAiApiDeps factory
|- handlers/
|  |- articles.ts      # AI article listing/management
|  |- articleById.ts   # Single AI article operations
|  |- submit.ts        # Submit AI-generated article for review
|  |- importContent.ts # Import external content via AI processing
|  |- notFound.ts      # 404 tracking for AI-discovered content gaps
|  |- assets.ts        # Asset management (uses separate AiAssetsDeps)
|  `- root.ts          # Root AI endpoint
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| AI content import | `handlers/importContent.ts` | Main import pipeline (65+ lines of setup) |
| AI article flow | `handlers/articles.ts`, `articleById.ts` | CRUD for AI-generated articles |
| Asset handling | `handlers/assets.ts` | Separate `AiAssetsDeps` type, not standard `AiApiDeps` |
| Content gap tracking | `handlers/notFound.ts` | Track pages AI should generate |

## CONVENTIONS
- AI articles go through the same review pipeline as user articles.
- `assets.ts` uses a separate `AiAssetsDeps` type — not the standard `AiApiDeps`.
- `importContent.ts` does heavy preprocessing before article creation.

## ANTI-PATTERNS
- Do not bypass article review queue for AI-generated content.
- Do not mix AI asset deps with standard AI deps — they are separate types.
