# Contributors

ZeroDelay is a collaborative effort. Thanks to everyone who has contributed code
(each commit's authorship is preserved in the Git history). This file is updated
with every newly merged contribution.

## Firefox support
- **Emanoel** ([@emanoeI](https://github.com/emanoeI)) — Firefox Desktop build:
  `manifest.firefox.json` + Node build + `web-ext` tooling — **PR #4 (merged)**;
  aligning the Firefox docs with the manifest — **PR #14 (merged)**.
- **Kweripx** ([@kweripx](https://github.com/kweripx)) — initial Firefox support
  in the manifest — **PR #1** (basis for #4).
- **Gabriel Fernandes** ([@GbrFrn](https://github.com/GbrFrn)) — Zen Browser
  development tooling: the `npm run run:zen` script and its docs, reusing the
  shared Firefox/Gecko build — **PR #26 (merged)**.

## Engine, tests and automation
- **juansilvadesign** ([@juansilvadesign](https://github.com/juansilvadesign)) —
  catch-up engine resilience, tests (`node:test`) and release tooling —
  **PR #5 (merged)**.
- **jrlucas1** ([@jrlucas1](https://github.com/jrlucas1)) — **predictive** catch-up
  from the buffer trend — **PR #13 (merged)** — plus the base for the CI pipeline
  and release automation (**PR #2**).
- **bruno-gianini** ([@brunogianini](https://github.com/brunogianini)) — fixing
  memory leaks in player and `chrome.storage` listeners — **PR #17 (merged)**.
- **RobertoMarconi** ([@RobertoMarconi](https://github.com/RobertoMarconi)) — idea of
  playing **below 1.0x to rebuild the buffer** (the "Estável" mode with a target
  slider, **PR #37**), reworked as buffer regulation into the **"Personalizado"**
  mode and a universal anti-stall brake across all modes — **PR #39 (merged)**.

## UX and accessibility
- **huandrey** ([@huandrey](https://github.com/huandrey)) — **keyboard shortcuts**
  (on/off and go-to-live, **PR #8**), keyboard **accessibility** + `aria-label`
  on the indicators (**PR #9**) and the locale parity check in CI (**PR #7**) —
  all merged.
- **MoreiraGustav** ([@MoreiraGustav](https://github.com/MoreiraGustav)) — keyboard
  shortcuts (**PR #10**); raised the idea of "go to live" acting only on the active
  tab, folded into **PR #16**.
- **Emanoel** ([@emanoeI](https://github.com/emanoeI)) — "go to live" shortcut
  restricted to the active tab (via `chrome.tabs.sendMessage`) — **PR #16 (merged)**.
- **Guilherme** ([@ventgui28](https://github.com/ventgui28)) — **"Go Live" button**
  for quick action right in the extension popup — **PR #15 (merged)**.
- **Cristian** ([@criszst](https://github.com/criszst)) — fixing the toggle of the
  "Support via PIX" CTA button, which now opens **and** closes the donation panel —
  **PR #20 (merged)**.
- **wthallys** ([@wthallys](https://github.com/wthallys)) — idea and base for the
  **per-channel mode memory** (**PR #22**), reworked (opt-in, without overriding
  the global mode, keyed by `channel_id`) and merged.
- **leandroohsr** ([@leandroohsr](https://github.com/leandroohsr)) — fixing the
  **stall watchdog**, which didn't reset its count between live streams and
  suggested a "calmer mode" for no reason (**PR #25, merged**); the collapsible
  **"Help · How to use"** section in the popup, a FAQ in all four languages for
  anyone who just installed it (**PR #28, merged**); the **"About ZeroDelay"** and
  **"Report an issue"** footer buttons linking the popup to the repository
  (**PR #32, merged**); the English translation of the developer documentation
  (**PR #33, merged**); the **light/dark theme toggle** in the popup header
  with the preference saved outside the engine state (**PR #34, merged**); and the
  **live-proximity meter** on each mode's buffer chip, a marker sliding toward a
  fixed live edge (**PR #35** — reworked for the new mode set and merged); and the
  **per-mode accent "temperature"**, giving each mode a colour that warms toward the
  live red as it gets more aggressive (**PR #41, merged**).
- **aantonioprado** ([@aantonioprado](https://github.com/aantonioprado)) —
  preventive XSS hardening in the popup's SVG parsing (sanitizing `on*`,
  `javascript:`/`data:` and scriptable nodes) — **PR #30 (merged)**.

## Hexa Mode
- **botelllhx** ([@botelllhx](https://github.com/botelllhx)) — the green-and-yellow
  **Hexa Mode** theme: visual redesign (live bar, bunting of little flags, native
  GOL button, "OLÊ OLÊ OLÁ" activation boot, badge), the popup header wearing the
  jersey, the redesigned beer icons and the fullscreen behavior tweak — commits on
  the `feat/modo-hexa` branch.

## Ideas and reports
- **Habini86** ([@Habini86](https://github.com/Habini86)) — idea of dynamic buffer
  management from arrival variation (**issue #12**), implemented in PR #13.
- **fsousac** ([@fsousac](https://github.com/fsousac)) — proposal to standardize
  the project's governance (**issue #3**).

---

ZeroDelay derives from the [live-catch-up](https://github.com/yudai-tiny-developer/live-catch-up)
extension by yudai-tiny-developer (see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)).
