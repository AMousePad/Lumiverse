# Frontend development

Run commands from `frontend/` with Bun. `bun run build:checked` generates the
component metadata, checks TypeScript, builds the application and PWA, and
atomically promotes the validated bundle to `dist/`.

## React Compiler trial

The default build uses the Babel React Compiler. To try Vite's experimental
native compiler:

```sh
LUMIVERSE_REACT_COMPILER=native bun run build:checked
LUMIVERSE_REACT_COMPILER=native bun run dev
```

Use `LUMIVERSE_REACT_COMPILER=babel` or leave the variable unset to return to the
default. Both paths target React 19 and compile only functions annotated with
`'use memo'`. Native compiler diagnostics remain visible. `MessageList` explicitly
uses `'use no memo'` because TanStack Virtual's mutable instance is incompatible
with compiler memoization.

The native binding is pinned in the lockfile. The trial has been built on macOS
arm64; Android/Termux, Windows, and Linux builds still need platform validation
before making it the default.

Run the production compiler regression tests with:

```sh
bun test --isolate scripts/react-compiler.test.tsx scripts/vite-chunks.test.ts
```

They build a fixture through each real Vite compiler path and exercise its
compiled output with React, including fresh Effect Event callbacks, Activity
effect cleanup/restart, and retained state and DOM drafts.

For a reproducible local build comparison, run from the same checkout with
dependencies installed:

```sh
bun run generate
bun run scripts/benchmark-react-compiler.ts
```

The script runs a warm-up per compiler, then three fresh-process builds per
compiler in alternating order. It uses the production runtime selection and a
fixed build ID, writes logs and `results.json` under `.tmp/compiler-benchmark/`,
and leaves `dist/` untouched. Timings include the production app and service
worker, excluding generation and type checking. JavaScript totals include all
emitted `.js` files, with each file gzipped separately.

Local comparison on 2026-10-18 (macOS arm64, Bun 1.4.2, Vite 8.3.4):

| Compiler | Build seconds (three samples) | Median | JavaScript gzip bytes |
| --- | --- | --- | --- |
| Babel | 2.140, 2.138, 2.143 | 2.140 s | 2,762,231 |
| Native | 2.073, 2.028, 2.030 | 2.030 s | 2,763,753 |

Native saved 0.110 s (5.1%) and added 1,522 gzip bytes. Keep Babel as the default:
the absolute gain is small, the [native compiler remains experimental](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md#rust-react-compiler),
and other supported platforms still need validation. Only `App` currently opts
into compilation; these measurements do not establish a runtime performance
improvement or predict results with broader annotation coverage.

The locale code-splitting group has `debugName: 'i18n-locales'` so Rolldown can
identify its functional name callback in timing reports. This label preserves
the existing per-language chunk names and `assets/i18n/` paths; both compiler
paths build without the missing-label warning.

## Retained settings panels

Display and Chat settings mount on first visit. React's `Activity` then preserves
their state and DOM while pausing effects when the category is hidden. Closing
the settings modal unmounts both. Other categories retain their existing
mount/unmount behavior.

## Landing gallery measurement snapshots

Opening a chat captures `virtualizer.takeSnapshot()` alongside the current DOM
scroll offset in the existing account-scoped landing snapshot. Returning to the
native gallery restores `initialMeasurementsCache`, `initialOffset`, and the
scroll margin. Only measured rows are persisted; other rows use estimates.
Snapshots also survive a reload in the chat route through the existing one-shot
session-storage bridge. They contain plain data, with no retained DOM or images.

Row keys/order, layout, column count, width, gap, estimate, viewport width, UI
scale, and font scale must match before cached measurements are accepted.
Malformed or older caches fall back to estimates and the saved offset. A
compatible card cache skips the initial `measure()` reset; subsequent responsive
changes still reset it. Compact rows retain their first measured height until
UI or font scaling changes. The first returning list consumes the saved state,
including when bootstrap
delays mounting it. Later layout switches cannot replay the return offset.
Extension-owned landing surfaces retain their DOM scroll-restoration behavior.

Run the regression tests and a reproducible initial-range comparison with:

```sh
bun test --isolate src/lib/landingVirtualSnapshot.test.ts src/components/landing/LandingPage.character-library.test.tsx
bun run scripts/benchmark-landing-snapshot.ts
```

The comparison uses synthetic variable-height rows and reports the initial
visible-row error with and without saved measurements, before DOM observers
run. It measures restoration accuracy, not frame rate or real chat latency.

Chat message snapshots remain separate work: bottom-pinning, streaming, swipes,
and HTML content require a different invalidation and reading-position policy.
See the [TanStack Virtualizer API](https://tanstack.com/virtual/latest/docs/api/virtualizer#takesnapshot).
