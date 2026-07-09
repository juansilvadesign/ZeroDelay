// ZeroDelay — keep YouTube live streams in real time
// Author: João Gustavo França <joao@solitus.com.br> (https://github.com/joaogfc)
//
// Drafts a social post from a released CHANGELOG section (issue #27): every
// release turns into a REVIEWABLE draft under social/drafts/ — never a direct
// publication. The workflow (.github/workflows/social-draft.yml) opens a PR
// with the draft; a human edits, approves, and posts it.
//
//   node scripts/social-draft.mjs            # latest released version
//   node scripts/social-draft.mjs 1.4.0      # a specific version
//
// With ANTHROPIC_API_KEY set the draft is written by Claude, grounded ONLY in
// the changelog section (repo tooling — the extension itself never talks to
// any server). Without the key it falls back to a template draft assembled
// from the changelog bullets — the workflow works with zero secrets.
//
// Raw fetch on purpose: every script in this repo is dependency-free (see
// scripts/build.mjs), and one small completions call doesn't justify an SDK.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const MODEL = process.env.SOCIAL_MODEL || 'claude-opus-4-8';
const STORE_CHROME = 'https://chromewebstore.google.com/detail/zerodelay/gblbnnkemjblakamnbclcehoaobnhlpm';
const STORE_FIREFOX = 'https://addons.mozilla.org/firefox/addon/zerodelay/';
const REPO = 'https://github.com/joaogfc/ZeroDelay';

// --- CHANGELOG parsing ------------------------------------------------------
// Sections look like "## [1.4.0] - 2026-07-07"; "## [Não lançado]" is skipped
// when resolving the default (you announce releases, not work in flight).
function parseChangelog(text) {
    const sections = [];
    const re = /^## \[([^\]]+)\](?: - (\S+))?$/gm;
    let match, prev = null;
    while ((match = re.exec(text)) !== null) {
        if (prev) prev.body = text.slice(prev.end, match.index).trim();
        prev = { version: match[1], date: match[2] || null, end: re.lastIndex };
        sections.push(prev);
    }
    if (prev) prev.body = text.slice(prev.end).trim();
    return sections;
}

// --- Template fallback (no API key) ----------------------------------------
// First-level bullets (with their wrapped continuation lines joined), markdown
// links/emphasis stripped, each trimmed to headline length.
function templateDraft(version, body) {
    const raw = [];
    for (const line of body.split('\n')) {
        const start = line.match(/^- (.+)$/);
        const cont = line.match(/^ {2,}(\S.*)$/);
        if (start) raw.push(start[1]);
        else if (cont && raw.length) raw[raw.length - 1] += ' ' + cont[1];
    }
    const bullets = raw.slice(0, 4).map(text => {
        const clean = text
            .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')   // [text](url) -> text
            .replace(/\*\*([^*]+)\*\*/g, '$1')          // **bold** -> bold
            .replace(/`([^`]+)`/g, '$1');
        // Headline = up to the first sentence end (or hard cap), never mid-word.
        const firstStop = clean.search(/[.:!?] /);
        const head = firstStop > 15 ? clean.slice(0, firstStop) : clean;
        return '• ' + (head.length > 110 ? head.slice(0, 107).replace(/\s+\S*$/, '') + '…' : head);
    });
    return [
        `🔴 ZeroDelay v${version} chegou!`,
        '',
        ...bullets,
        '',
        `Chrome: ${STORE_CHROME}`,
        `Firefox: ${STORE_FIREFOX}`,
    ].join('\n');
}

// --- Claude draft (optional) ------------------------------------------------
async function claudeDraft(version, body) {
    const prompt = [
        `Você escreve os posts do ZeroDelay, uma extensão open-source (GPL) que`,
        `mantém lives do YouTube em tempo real. Abaixo está a seção do CHANGELOG`,
        `da versão ${version}. Escreva DOIS rascunhos de post em pt-BR:`,
        '',
        '1. **X/Twitter** (máx ~280 caracteres): direto, uma melhoria em destaque,',
        '   tom de quem fala com espectador de live, zero jargão corporativo.',
        '2. **Instagram** (caption curta): 2-4 linhas + até 4 hashtags discretas.',
        '',
        'Regras: baseie-se SOMENTE no changelog abaixo (não invente recursos);',
        'nada de hype vazio ("revolucionário", "incrível"); pode usar 1-2 emojis;',
        `termine com o link da loja: ${STORE_CHROME}`,
        '',
        '--- CHANGELOG ---',
        body,
    ].join('\n');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 2048,
            messages: [{ role: 'user', content: prompt }],
        }),
    });
    if (!res.ok) throw new Error(`Claude API: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    if (data.stop_reason === 'refusal') throw new Error('Claude API: request refused');
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!text) throw new Error('Claude API: empty response');
    return text;
}

// --- Main --------------------------------------------------------------------
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const sections = parseChangelog(changelog);

const wanted = (process.argv[2] || '').replace(/^v/, '');
const section = wanted
    ? sections.find(s => s.version === wanted)
    : sections.find(s => /^\d/.test(s.version));   // newest released (skips "Não lançado")

if (!section || !section.body) {
    console.error(`✗ CHANGELOG section not found${wanted ? ` for version ${wanted}` : ''}.`);
    process.exit(1);
}

let draft, source;
if (process.env.ANTHROPIC_API_KEY) {
    try {
        draft = await claudeDraft(section.version, section.body);
        source = `IA (${MODEL})`;
    } catch (e) {
        console.error(`! ${e.message} — falling back to the template draft.`);
    }
}
if (!draft) {
    draft = templateDraft(section.version, section.body);
    source = source || 'template (sem ANTHROPIC_API_KEY)';
}

const outDir = join(root, 'social', 'drafts');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `v${section.version}.md`);
if (existsSync(outPath)) console.error(`! overwriting existing draft: social/drafts/v${section.version}.md`);

writeFileSync(outPath, [
    '---',
    'status: rascunho          # vira "aprovado" só depois de revisão humana',
    `versao: ${section.version}`,
    `fonte: ${source}`,
    `gerado_em: ${new Date().toISOString()}`,
    '---',
    '',
    `# Rascunho de post — ZeroDelay v${section.version}`,
    '',
    '> Revisão humana obrigatória antes de publicar (social/README.md).',
    `> Créditos de quem contribuiu na versão: ver CONTRIBUTORS.md e o CHANGELOG.`,
    '',
    draft,
    '',
    '---',
    '',
    `Repositório: ${REPO}`,
    '',
].join('\n'));

console.log(`✓ social/drafts/v${section.version}.md (${source})`);
