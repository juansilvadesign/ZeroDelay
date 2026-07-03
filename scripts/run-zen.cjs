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

const webExtBinary = path.join(
    root,
    'node_modules',
    '.bin',
    isWindows ? 'web-ext.cmd' : 'web-ext'
);
const webExt = fs.existsSync(webExtBinary) ? webExtBinary : 'web-ext';

const args = [
    'run',
    '--source-dir',
    path.join(root, 'dist', 'firefox'),
    '--firefox',
    zenBinary,
    '--arg=--new-instance',
];

if (process.env.ZEN_PROFILE) {
    args.push(
        '--firefox-profile',
        process.env.ZEN_PROFILE,
        '--profile-create-if-missing',
        '--keep-profile-changes'
    );
}

args.push(...process.argv.slice(2));

console.log(`Starting Zen Browser: ${zenBinary}`);
const result = spawnSync(webExt, args, { stdio: 'inherit' });

if (result.error) {
    console.error(result.error.message);
    process.exit(1);
}

process.exit(result.status ?? 0);
