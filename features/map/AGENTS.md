# MAP FEATURE MODULE

## OVERVIEW
`features/map/` is the primary client-side map feature module (21 files, 8952 lines). Uses a "mega-hook ctx injection" pattern where `AnitabiMapPageClientImpl.tsx` (~800 lines) orchestrates state passed to specialized hooks.

## STRUCTURE
```text
features/map/
|- AnitabiMapPageClientImpl.tsx  # Main orchestrator (~800 lines, ctx hub)
|- AnitabiMapPageClient.tsx      # Universal entry point
`- anitabi/
   |- shared.ts                  # Types, constants, FIFO cache (~776 lines)
   |- useAnitabiBootstrapData.ts # Data fetching, pagination, caching
   |- useAnitabiWarmup.ts        # Image/metadata preloading (~694 lines)
   |- useAnitabiSelection.ts     # Selection state machine, URL sync
   |- useAnitabiDerivedState.ts  # Filtering, sorting, distance computation
   |- useCompleteMode.ts         # "Complete" visualization mode (~788 lines)
   |- useMapInteractionActions.tsx # Click/hover handlers (~661 lines)
   |- media.ts                   # Image/URL helpers (~685 lines)
   |- AnitabiMapLayout.tsx       # Visual shell (sidebar, panels, map)
   `- geo.ts                     # Spatial math utilities
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Bootstrap data flow | `anitabi/useAnitabiBootstrapData.ts` | Manifest → cards → detail fetch chain |
| Selection behavior | `anitabi/useAnitabiSelection.ts` | State machine for bangumi/point selection |
| Performance preloading | `anitabi/useAnitabiWarmup.ts` | Parallel image/metadata warmup with cacheStoreRef |
| Complete mode logic | `anitabi/useCompleteMode.ts` | Extended visualization with all points |
| Map interaction | `anitabi/useMapInteractionActions.tsx` | Click, hover, popup triggers |
| Shared types/cache | `anitabi/shared.ts` | bangumiDetailCache (FIFO Map), constants, L dict |

## CONVENTIONS
- State flows through a single `ctx` object from AnitabiMapPageClientImpl to hooks — do not create parallel state channels.
- Extensive useRef for MapLibre instances and abort controllers — avoid converting refs to useState.
- Manual FIFO cache in shared.ts bypasses render cycles intentionally — do not replace with React state.
- Rendering logic belongs in `components/map/`; state/data logic stays here.

## ANTI-PATTERNS
- Do not add useState where useRef is used for performance (MapLibre instances, abort controllers, counters).
- Do not break the ctx injection pattern by creating new contexts or stores.
- Do not move data transformation logic into `components/map/` render paths.
- Do not add direct Prisma or server calls — this is client-only code.

## NOTES
- 8 of 21 files exceed 500 lines; most are on the line-budget allowlist.
- Data flow: Bootstrap → Warmup → Selection → DerivedState → Render.
- `QuickPilgrimageMode` (in `components/quickPilgrimage/`) consumes data from this module's state.
