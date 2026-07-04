# ZeroDelay — Improvement and Implementation Plan

> Planning document. It doesn't change behavior on its own — it describes what,
> why, and in what order. Each item points to `file:line` so it's actionable.

## Context (architecture in 4 lines)

- `content.js` — content script (isolated world). Bridges `chrome.storage` →
  page via `CustomEvent`, injects `inject.js`, and handles the donation/stall UI.
- `inject.js` — the **engine**, runs in the page world (MAIN). Every 250 ms it
  reads **private** player APIs (`getStatsForNerds`, `getProgressState`, …) and
  applies `player.setPlaybackRate()`. Renders the player indicators.
- `common.js` — shared config: storage keys, defaults, presets/modes, i18n,
  donation logic.
- `popup.js` / `background.js` / `pix.js` — settings UI, service worker (donation
  badge) and the local PIX (BR Code) generator.

The single point of failure was the engine's coupling to YouTube's internal APIs,
previously **with no protection at all** — hardened in Phase 0. Phases 0 and 1
are complete.

---

## Current state (2026-07-01)

- **Phase 0 — Engine resilience:** ✅ complete (2026-06-30) — R1–R3.
- **Phase 1 — Release hygiene + tests:** ✅ complete (2026-07-01) — H1–H5.
- **Next:** Phase 2 (U1–U5) — keyboard shortcuts, a11y, Firefox, dev docs.
- **Project health:** `manifest` v1.1 · **21 tests** `node:test` green · ESLint
  (flat, v9) **clean** · `npm run build` → `build/zerodelay-1.1.zip` (19 files,
  manifest at the root, verified by an independent ZIP reader).

---

## Prioritized summary

| ID | Improvement | Priority | Effort | Impact |
| --- | --- | --- | --- | --- |
| ✅ R1 | `try/catch` + feature-detect in the engine loop | **P0** | 2–3 h | High |
| ✅ R2 | Re-detection on SPA navigation (`yt-navigate-finish`) | **P0** | 2 h | High |
| ✅ R3 | Visible degradation when the APIs disappear | **P0** | 1 h | Medium |
| ✅ H1 | `package.json` + build/zip script + version-stamp | **P1** | 2–3 h | High |
| ✅ H2 | Reconcile version (1.1 vs 1.0) and brand (“Live Sync” → ZeroDelay) | **P1** | 30 min | Medium |
| ✅ H3 | Extract pure logic + tests (PIX, modes, controller) | **P1** | 4–6 h | High |
| ✅ H4 | ESLint + CI (lint/test/build) — *Prettier deferred* | **P1** | 2 h | Medium |
| ✅ H5 | Remove dead code (`calc_threathold`/`calc_segduration`) | **P1** | 15 min | Low |
| ✅ U1 | Keyboard shortcuts (`commands`: on/off, go to live) | P2 | 2 h | Medium |
| ✅ U2 | A11y: arrow-key navigation in the radiogroup + `aria-label` on the indicators | P2 | 2 h | Medium |
| ✅ U3 | Firefox support (`browser_specific_settings`) | P2 | 1–2 h | Medium |
| U4 | Dev docs (dev README, CHANGELOG, CONTRIBUTING) | P2 | 2 h | Low |
| U5 | Per-channel mode memory + “go to live” chip in the popup | P2 | 3–4 h | Low |

---

## Phase 0 — Engine resilience (P0) — ✅ Complete

> **✅ Completed on 2026-06-30 — Engine resilience (R1–R3).**
> The 250 ms loop hardened with `try/catch` + feature-detection of the player's
> private APIs (gives up after 8 errors in a row, with 1 console warning),
> idempotent re-detection on SPA navigation (`yt-navigate-finish`) and indicators
> that disappear on degradation (never leave frozen values). Scope: only
> `inject.js` (+166 −64).

The extension's entire value lives inside a 250 ms `setInterval`
(`inject.js:359-399`) that calls undocumented YouTube APIs. Any player refactor
takes everything down — 4×/second, forever, with no signal.

### R1 — Protect the loop and detect the APIs once
- **Where:** `inject.js:350-408` (the `_live_catch_up_load_settings` handler) and
  the `setInterval` body.
- **What:**
  1. When the player is detected, check once for the presence of each API used
     (`getStatsForNerds`, `getProgressState`, `getVideoData`, `setPlaybackRate`,
     `getPlaybackRate`, `seekToLiveHead`, `getPlayerStateObject`). Store them in a
     `caps` object.
  2. Wrap the tick body in `try/catch`. On error: increment `consecutiveErrors`;
     after ~8 failures in a row, `clearInterval`, hide indicators and
     `console.warn` **once** (`[ZeroDelay] player API changed…`).
  3. Only call each function if `caps` says it exists; otherwise, skip that effect
     (e.g. no `seekToLiveHead` → disable the skip, keep the rest).
- **Acceptance:** simulating the absence of `getStatsForNerds` doesn't cause an
  exception loop; the rest (the possible indicators) keeps working; a single
  warning appears.

### R2 — Re-detection on SPA navigation
- **Where:** `inject.js:414-450` (`detect_interval` runs **once** and calls
  `clearInterval`); there's no navigation listener in `content.js`/`inject.js`.
- **Why:** YouTube is an SPA. Switching live streams in the same tab doesn't
  reload the script; the indicators can be orphaned and the engine can point at
  stale state.
- **What:** listen for `yt-navigate-finish` (and/or `yt-player-updated`) to re-run
  the player detection and re-insert the buttons if the `time-display` was
  rebuilt. Make the insertion idempotent (don't duplicate buttons if already
  present).
- **Acceptance:** navigating between two live streams without a reload keeps
  indicators and catch-up working; no duplicated buttons.

### R3 — Visible degradation
- **Where:** the consumer of R1's error state.
- **What:** when the engine drops into degraded mode, hide the indicators instead
  of showing frozen values; optionally reflect “unavailable” in the popup via a
  flag in `chrome.storage` read by `popup.js`.
- **Acceptance:** no “stuck” indicators on screen after an API loss.

---

## Phase 1 — Release hygiene and maintenance (P1) — ✅ Complete

> **✅ Completed on 2026-07-01 — Release hygiene + tests.**
> Dead code removed (H5); version/brand reconciled — the popup is now
> “ZeroDelay” (H2); `package.json` + **zero-dependency** build in pure Node
> (`node:zlib`, no `zip` binary) that generates `build/zerodelay-1.1.zip` with the
> manifest at the root, plus a manifest `validate` (H1); the catch-up controller
> was extracted into `engine/controller.js` (dual Node/browser via
> `engine/package.json`) and covered by **21 tests** `node:test` — PIX/CRC, modes
> and controller, all green (H3); ESLint flat config + CI on GitHub Actions (H4;
> Prettier deferred). The build was verified by an independent ZIP reader (CRCs
> OK, manifest at the root, no leaking `.git`/dev).

### H1 — Reproducible build
- **Problem:** `CHECKLIST.md:11` mentions `build/zerodelay-1.0.zip`, but there's
  **no script** that generates it — it's manual, and it has already drifted (see
  H2).
- **What:** `package.json` with scripts:
  - `build` → generates `build/zerodelay-<version>.zip` reading the version from
    `manifest.json`, **excluding** `.git`, `publishing/`, `ROADMAP.md`, `test/`,
    `node_modules`, dev-config.
  - `version:patch|minor` → bumps the version in `manifest.json` atomically.
  - `validate` → basic manifest check (required fields, no `key`/`update_url`).
  Zero heavy dependencies (just `zip`/`archiver` + Node).
- **Acceptance:** `npm run build` produces a zip with `manifest.json` at the root,
  named by the real version, with no dev files.

### H2 — Reconcile version and brand
- **Version:** `manifest.json:32` is at `1.1`, but `CHECKLIST.md` and the zip
  mention `1.0`. Set the source of truth (the manifest) and fix the text.
- **Brand:** the popup shows `label.appName` = **“Live Sync”** (en) /
  **“Sincronizador de Live”** (pt) — `common.js:19`, `_locales/en/messages.json:5`,
  while the product/manifest/README is **“ZeroDelay”**. Unify `appName` to
  “ZeroDelay” in both locales (or localize the manifest `name` via `__MSG__`).
- **Acceptance:** the popup header and the store name match; the checklist
  reflects the real version.

### H3 — Extract pure logic + tests
The biggest quality lever. Everything below is deterministic and testable without
a DOM:
- **PIX (`pix.js`):** `crc16` and `buildPixCode` against known-good “copy and
  paste” codes (the CRC is the part that most often breaks silently).
- **Modes (`common.js`):** round-trip `presets[x]` → `deriveMode` === `x`;
  `limitValue`/`range`/`step`; `donateEligible`; `calmerMode`.
- **Catch-up controller:** extract `calc_playbackRate`, `auto_buffer_target`,
  `accel_allowed_by_buffer` from `inject.js:151-186` into a pure module
  (e.g. `engine/controller.js`) with no global state, and test: high buffer →
  speeds up; buffer at the floor → 1.0x; latency < `MIN_LATENCY` → 1.0x;
  hysteresis (`CATCH_UP_BAND`) doesn't keep oscillating.
- **Runner:** `node:test` (native, no dependency) or `vitest`.
- **Acceptance:** `npm test` green covering PIX, modes and controller.

### H4 — Lint + format + CI
- ESLint (light rules, `no-unused-vars` catches the dead code from H5) + Prettier.
- GitHub Actions: `lint` + `test` + `build` on push/PR; attach the zip on `v*`
  tags.
- **Acceptance:** a green PR required; build artifact published on the release.

### H5 — Remove dead code
- **Where:** `inject.js:188-210` — `calc_threathold` and `calc_segduration` are
  defined and **never called** (the skip uses the `skipThreathold` from config,
  not these). Remove them.
- **Acceptance:** lint with no `no-unused`; identical behavior.

---

## Phase 2 — UX, accessibility and features (P2)

### U1 — Keyboard shortcuts — ✅ Complete
- `commands` in the manifest + a handler in `background.js`: toggles the current
  mode on/off and “jump to live” without opening the popup.
- **Done:** `toggle-enabled` (`Alt+Shift+Y` / `⌘+Shift+Y`) toggles between `off`
  and the last mode (via `common.toggleEnabledAction` + the `lastMode` meta key);
  `go-live` (`Alt+Shift+L` / `⌘+Shift+L`) writes a signal (`common.emitGoLive`)
  that `content.js` forwards to the engine (`seek_to_live`).

### U2 — Accessibility — ✅ Complete
- Mode cards are `role="radio"` (`popup.js:90`) but without arrow-key navigation
  or a single tab-stop; implement the radiogroup pattern (arrows move, a single
  tab-stop).
- Player indicator buttons (`inject.js:294-306`) without `aria-label`; add labels
  (“speed”, “latency”, “buffer”).
- **Done:** a `wireRadiogroup` helper (roving tabindex + arrows/Home/End) on the
  mode cards; localized `aria-label` on the indicators (they travel in the
  settings detail, since the engine can't access `chrome.i18n`).

### U3 — Firefox — ✅ Manifest/build implemented; external validation pending
- Implemented: `manifest.firefox.json` with `browser_specific_settings.gecko`
  (id `zerodelay@joaogfc`, `strict_min_version` 140) and a `gecko_android` block
  (`strict_min_version` 142). The Firefox manifest's `background` uses `scripts`
  + `type: module` (not a service worker). Build via `scripts/build-firefox.cjs`
  (`npm run build:firefox`), with `data_collection_permissions` already declared
  (`required: ["none"]`). `content.js:46` uses `cloneInto`.
- Pending (not proven in the repo): testing on Firefox for Android and
  publishing/validation on AMO (signing and package submission).

### U4 — Dev documentation
- A development README (load unpacked, `npm run build`), `CHANGELOG.md` (starting
  at 1.1) and `CONTRIBUTING.md` (GPL-3.0 project).

### U5 — Optional features
- Per-channel mode memory (remember the mode chosen per `channelId`).
- A “go to live now” chip in the popup, in addition to the automatic skip.
- **Migration note:** the persisted key `skipThreathold` (a misspelling of
  *threshold*, in `common.js`/`content.js`/`inject.js`) should only be renamed
  with a storage migration — otherwise it resets existing users' setting. Low
  priority; purely cosmetic.

---

## Suggested execution order

1. ~~**R1 → R2 → R3** (harden the engine)~~ — ✅ completed on 2026-06-30.
2. ~~**H5 + H2** (quick, low-risk cleanup)~~ — ✅ completed on 2026-07-01.
3. ~~**H1 + H4** (build + CI to lock down regressions)~~ — ✅ completed on 2026-07-01.
4. ~~**H3** (extract and test)~~ — ✅ completed on 2026-07-01.
5. **U1–U5** as appetite allows.

## What's already good (don't touch)

- Well-done optional donation: respects opt-out/snooze, gated on real usage,
  never blocks the extension (`common.js:127-131`, `content.js:81-161`).
- 100% local PIX, no network (compatible with the MV3 “no remote code” rule).
- A stall watchdog that only offers a **calmer** mode — a good antidote to misuse.
- `setPlaybackRate` control that yields to the user when they change the speed
  manually (`inject.js:104-121`).
