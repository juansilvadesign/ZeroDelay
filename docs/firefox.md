# ZeroDelay on Firefox

ZeroDelay runs on Firefox Desktop with the same code that serves Chrome and Edge.
The latency catch-up engine, the modes and the player indicators are the same —
only the manifest changes, generated separately for Firefox.

## Building

```
npm install
npm run build:firefox
```

That's it: the `dist/firefox` folder comes out ready to load in Firefox or to
package.

The `scripts/build-firefox.cjs` script copies the extension files into
`dist/firefox` and uses `manifest.firefox.json` as the manifest. It's a straight
copy, with no bundler.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run build:firefox` | Generates `dist/firefox` |
| `npm run lint:firefox` | Validates the build with `web-ext lint` |
| `npm run run:firefox` | Opens Firefox with the extension already loaded |
| `npm run run:zen` | Opens Zen Browser with the extension already loaded |
| `npm run package:firefox` | Packages the `.zip` into `web-ext-artifacts` |

## Why two manifests

Chrome and Edge load the root `manifest.json`, with `background` running as a
*service worker*. Firefox prefers `background.scripts`, so `manifest.firefox.json`
swaps that part for `scripts` + `type: module` and declares
`browser_specific_settings.gecko` (ID and minimum version). Permissions, content
scripts and web resources stay the same in both.

Two Gecko specifics that the manifest and the code already handle:

- Firefox wants `author` as text, not as an object, so each manifest declares it
  its own way;
- when delivering the content script settings to the page, the Firefox version
  passes the object through `cloneInto`, respecting Gecko's world isolation.

All the APIs used (`storage`, `runtime`, `alarms`, `action`, `tabs`, `i18n`)
exist in both engines under the `chrome.*` namespace, which Firefox also exposes.

## Zen Browser

Zen Browser is based on Firefox/Gecko, so it uses the same build in
`dist/firefox`. To load the extension temporarily in Zen:

```bash
npm run run:zen
```

The script calls `web-ext` with the Zen binary. It looks for `zen-browser`,
`zen` or `zen-bin` on the `PATH`; if needed, set `ZEN_BINARY`:

```bash
ZEN_BINARY=/opt/zen-browser-bin/zen-bin npm run run:zen
```

To reuse a test profile between runs:

```bash
ZEN_PROFILE=/tmp/zerodelay-zen npm run run:zen
```

Permanent installs still follow the Firefox/Zen signing and policy rules; this
script covers the local development flow.

## Reach

`manifest.firefox.json` declares Firefox Desktop from version **140** in
`browser_specific_settings.gecko`, and a `gecko_android` block from version
**142**. Android support is only declared in the manifest; there is no record of
device testing in this repository.

The manifest also includes `data_collection_permissions` with
`required: ["none"]`, an explicit declaration of no data collection in the
Firefox package. The store publishing itself (signing and package submission) is
a separate step and is not part of this build.
