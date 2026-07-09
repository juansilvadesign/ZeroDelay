# ZeroDelay

**English** · [Português (Brasil)](README.pt-BR.md)

<p align="center">
  <a href="https://chromewebstore.google.com/detail/zerodelay/gblbnnkemjblakamnbclcehoaobnhlpm">
    <img alt="Get ZeroDelay for Chrome" src="https://img.shields.io/badge/Chrome%20Web%20Store-Install-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white">
  </a>
  &nbsp;
  <a href="https://addons.mozilla.org/en-US/firefox/addon/zerodelay/">
    <img alt="Get ZeroDelay for Firefox" src="https://img.shields.io/badge/Firefox%20Add--ons-Install-FF7139?style=for-the-badge&logo=firefoxbrowser&logoColor=white">
  </a>
</p>

A browser extension that helps YouTube live streams get back to real time when
the player falls behind.

When a live stream with DVR enabled starts to lag, the extension can temporarily
raise the playback speed, watch the buffer health, optionally jump back to live
if the delay grows too large, and show extra stream stats right inside the
YouTube player UI.

## Features

- One-tap modes, from gentle catch-up (for weak connections) to minimum latency,
  which keeps you as close to live as possible
- Automatically speeds up while the live stream is behind and returns to `1.0x`
  as soon as it catches up
- Modes closer to live that keep pulling toward the edge by using up the buffer
- Jump to live when the delay crosses a threshold (on by default at 30s)
- Each mode shows the internet speed it works best with
- Optional player indicators: playback speed, live latency and buffer health
- The added controls blend into YouTube's standard player UI and stay available
  even in fullscreen
- Also works in the YouTube embedded player
- Keyboard shortcuts to toggle on/off (`Alt+Shift+Y`) and jump to live
  (`Alt+Shift+L`) — `⌘+Shift+…` on Mac — remappable at
  `chrome://extensions/shortcuts`
- One-tap **Copy diagnostics** (the engine's last ~2 minutes, ready to paste
  into a bug report) and a shareable **session summary** — both 100% local,
  copied only when you ask

## Settings

Everything is delivered through one-tap **modes**. The accelerator raises the
speed only as much as needed (a gentle `1.25x`) to consume content that's already
downloaded and pull you back to real time, which **reduces live latency**. Then
it rests at `1.0x`, which *holds* the latency — so it acts in short bursts, not
all the time, and only acts again when you fall behind (after a stall). Each mode
keeps a different amount of **buffer**: less buffer = closer to live, but needs a
better connection. Jump to live is on by default at 30s.

> **Note:** modern YouTube live streams ("SABR / manifestless") ignore direct
> changes to `video.playbackRate`; the engine uses the player's own
> `setPlaybackRate()` API, which is what actually makes catch-up work on them.

### Modes

| Mode | Keeps buffer | Recommended internet |
| --- | --- | --- |
| **Off** | — | Any |
| **Automatic** ⭐ | adapts | Any (adjusts) |
| **Balanced** | ~4s | ~5–10 Mbps |
| **Close** | ~3s | Stable ~15+ Mbps |
| **Extreme** | ~2s | Fast/stable ~50+ Mbps |
| **Custom** | 1–6s (you set) | Any (you tune it) |

**Automatic** (the default) measures your connection (bandwidth, buffer
stability, stalls) and adjusts the buffer target on the fly — closer to live when
your internet can take it, more buffer when it wavers. In every mode an anti-stall
brake slows playback slightly below `1.0x` to rebuild the cushion when it runs thin
(instead of only resting at `1.0x`), so even the aggressive modes are much harder to
stall. **Custom** lets you set the target buffer yourself (a 1–6s slider), held by
that same brake. The lowest possible latency is the stream's own live edge (the
encoding → ingest → transcoding → server CDN floor), which no viewer-side tool can
beat.

### Player indicators

Optional readouts shown on the YouTube player bar (next to the live badge):

- `Display current playback rate`
- `Display current live latency`
- `Display current buffer health`

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) to learn how to
run the extension locally, the code style, and how to open a good Pull Request.
By taking part, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

- Found a bug or have an idea? [Open an issue](https://github.com/joaogfc/ZeroDelay/issues/new/choose).
- Found a security flaw? Don't open a public issue — see [SECURITY.md](SECURITY.md).
- The change history lives in [CHANGELOG.md](CHANGELOG.md).

## Author

Created by **João Gustavo França**

- GitHub: [@joaogfc](https://github.com/joaogfc)
- Email: [joao@solitus.com.br](mailto:joao@solitus.com.br)

Enjoying it? Tap the "Support" button in the popup to buy me a coffee via PIX
(Brazil's instant-payment system). The QR code and copy-and-paste code are
generated locally — no data leaves your browser.

## License

Copyright © 2026 João Gustavo França

This program is free software: you can redistribute it and/or modify it under the
terms of the **GNU General Public License v3.0 (GPL-3.0)**, as published by the
Free Software Foundation. It is distributed WITH NO WARRANTY. See
[LICENSE](LICENSE) for the full text.

### Derivative work and third-party components

ZeroDelay is a **derivative work** of the
[live-catch-up](https://github.com/yudai-tiny-developer/live-catch-up) extension
by **yudai-tiny-developer**, originally licensed under **MIT** and
**Apache-2.0**. Those licenses allow use in a derivative work relicensed under
GPL-3.0, as long as their notices are preserved.

The bundled QR code generator (`vendor/qrcode.js`) is © 2009 Kazuhiko Arase under
the MIT license, which is GPL-compatible.

The full license notices for these components are in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
