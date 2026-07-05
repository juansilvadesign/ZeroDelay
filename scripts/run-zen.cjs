// Launches the Firefox/Gecko build in Zen Browser through web-ext.
// This keeps Zen support as development tooling; the shipped extension code and
// manifest stay shared with Firefox.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';

function resolveBinary(value) {
    if (!value) return null;
    if (/[\\/]/.test(value)) {
        return fs.existsSync(value) ? value : null;
    }

    const result = spawnSync(isWindows ? 'where' : 'which', [value], {
        encoding: 'utf8',
    });
    return result.status === 0 ? result.stdout.split(/\r?\n/)[0] : null;
}

function findZenBinary() {
    const candidates = [
        process.env.ZEN_BINARY,
        'zen-browser',
        'zen',
        'zen-bin',
        '/opt/zen-browser-bin/zen-bin',
        '/Applications/Zen Browser.app/Contents/MacOS/zen',
    ];

    for (const candidate of candidates) {
        const resolved = resolveBinary(candidate);
        if (resolved) return resolved;
    }

    return null;
}

const zenBinary = findZenBinary();
if (!zenBinary) {
    console.error('Could not find Zen Browser. Set ZEN_BINARY=/path/to/zen-bin and try again.');
    process.exit(1);
}

// Run web-ext's JS entry point directly through Node rather than the platform
// shim in node_modules/.bin. Spawning the `.cmd` shim without a shell throws
// EINVAL on modern Node for Windows (the CVE-2024-27980 hardening); a shell, in
// turn, would choke on the spaces this repo's path can contain. Invoking the
// script with process.execPath sidesteps both.
const webExtJs = path.join(root, 'node_modules', 'web-ext', 'bin', 'web-ext.js');

const runArgs = [
    'run',
    '--source-dir',
    path.join(root, 'dist', 'firefox'),
    '--firefox',
    zenBinary,
    '--arg=--new-instance',
];

if (process.env.ZEN_PROFILE) {
    runArgs.push(
        '--firefox-profile',
        process.env.ZEN_PROFILE,
        '--profile-create-if-missing',
        '--keep-profile-changes'
    );
}

runArgs.push(...process.argv.slice(2));

// Prefer the resolved JS entry point; fall back to the .bin shim (with a shell,
// which the shim needs on Windows) only if the package layout is unexpected.
const hasJs = fs.existsSync(webExtJs);
const command = hasJs ? process.execPath : path.join(root, 'node_modules', '.bin', isWindows ? 'web-ext.cmd' : 'web-ext');
const args = hasJs ? [webExtJs, ...runArgs] : runArgs;

console.log(`Starting Zen Browser: ${zenBinary}`);
const result = spawnSync(command, args, { stdio: 'inherit', shell: !hasJs });

if (result.error) {
    console.error(result.error.message);
    process.exit(1);
}

process.exit(result.status ?? 0);
