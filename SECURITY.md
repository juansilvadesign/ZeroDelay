# Security Policy

## Supported versions

ZeroDelay is a browser extension distributed through the Chrome Web Store and
built for Firefox. Only the **latest published version** receives security fixes.
Always update to the latest version before reporting.

## How to report a vulnerability

**Do not open a public issue** to report security flaws. That would expose the
problem before a fix is available.

Please use one of the private channels below:

1. **GitHub Security Advisories** (recommended): use the
   [*Report a vulnerability*](https://github.com/joaogfc/ZeroDelay/security/advisories/new)
   button on the repository's **Security** tab.
2. **Email:** send the details to
   [joao@solitus.com.br](mailto:joao@solitus.com.br) with the subject starting
   with `[SECURITY] ZeroDelay`.

Include, if possible:

- A description of the flaw and its potential impact;
- Steps to reproduce (live stream URL, mode in use, browser and version);
- Any relevant proof of concept, log or screenshot.

## What to expect

- **Acknowledgement of receipt:** within 5 business days.
- **Initial assessment and next steps:** within 15 business days.
- We'll keep you informed on the progress of the fix and will agree on public
  disclosure only after a fixed version has been published.

We ask that you allow a reasonable amount of time for the fix before disclosing
the flaw publicly. Responsible reports will be credited in
[CHANGELOG.md](CHANGELOG.md), if you wish.

## Scope

The extension runs entirely in the browser and **does not send data to external
servers**. Features like the PIX donation QR code are generated **locally**.
Especially useful reports involve:

- Leaking user data outside the browser;
- Running untrusted code from page content;
- Improper escalation of the extension's permissions.
