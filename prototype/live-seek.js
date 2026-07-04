// ============================================================================
// ZeroDelay — PROTÓTIPO de pesquisa: "seek-para-dentro-do-buffer" + hold
// ----------------------------------------------------------------------------
// NÃO faz parte da extensão. É um experimento standalone para validar, numa
// aba em PRIMEIRO PLANO, a técnica descoberta em docs/RESEARCH-LATENCY.md §0:
//
//   O player de live do YouTube já baixa ~15s de mídia À FRENTE do playhead,
//   mas reproduz ~22s atrás do ao vivo (readahead conservador). A mídia nova
//   já está no buffer. Pular o playhead para `video.buffered.end - cushion`
//   reclama ~15s de latência INSTANTANEAMENTE, sem baixar nada. `seekToLiveHead()`
//   é no-op nessas lives SABR (o player já se acha "at live head").
//
// COMO USAR:
//   1. Abra uma live do YouTube e deixe a aba em primeiro plano.
//   2. Abra o DevTools (F12) → Console.
//   3. Cole este arquivo inteiro e Enter.
//   4. Um HUD aparece no canto. Observe a latência cair e SEGURAR.
//      - Botão "Pausar/Ativar" liga/desliga o catch-up (compare baseline vs ativo).
//      - window.__liveSeek.stop()  remove tudo.
//      - Ajuste ao vivo:  window.__liveSeek.cfg.targetCushion = 5
//
// Métricas no HUD:  latência atual | buffer | folga atual | nº seeks | nº stalls
// ============================================================================
(() => {
  'use strict';
  if (window.__liveSeek) { window.__liveSeek.stop(); }

  const cfg = {
    targetCushion: 4.0,   // s de buffer a deixar à frente após o seek (menor = + perto do vivo, + risco)
    rejumpAt: 8.0,        // re-seek quando (bufferedEnd - playhead) passar disso
    cushionMax: 9.0,      // teto da folga adaptativa
    stallBump: 1.5,       // quanto a folga sobe a cada travada
    decayPerTick: 0.02,   // folga volta devagar ao alvo quando estável (por tick de 1s)
    tickMs: 1000,
    minLatencyGuard: 2.0, // já colado no vivo -> não faz nada
  };

  const player = document.getElementById('movie_player');
  const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
  if (!player || !video || typeof player.getStatsForNerds !== 'function') {
    console.warn('[live-seek] Player/live não encontrado. Abra uma live do YouTube primeiro.');
    return;
  }

  const st = {
    enabled: true,
    cushion: cfg.targetCushion,
    seeks: 0,
    stalls: 0,
    lastStallAt: 0,
    lastSeekAt: 0,
    baselineLat: null,   // primeira latência vista (referência)
    loop: null,
  };

  const bufferedEnd = () => {
    let b = 0;
    for (let i = 0; i < video.buffered.length; i++) b = Math.max(b, video.buffered.end(i));
    return b;
  };
  const stat = () => {
    const s = player.getStatsForNerds();
    return {
      lat: parseFloat(s.live_latency_secs),
      buf: parseFloat(s.buffer_health_seconds),
    };
  };

  // ---- salvaguarda: travada -> aumenta a folga (recua) ---------------------
  const onWaiting = () => {
    st.stalls++;
    const now = performance.now();
    if (now - st.lastStallAt > 4000) {
      st.cushion = Math.min(cfg.cushionMax, st.cushion + cfg.stallBump);
      st.lastStallAt = now;
    }
  };
  video.addEventListener('waiting', onWaiting);

  // ---- núcleo: decide e executa o seek ------------------------------------
  function tick() {
    updateHud();
    if (!st.enabled) return;
    if (player.getPlayerState() !== 1) return; // só quando tocando
    if (video.seeking) return;                 // não brigar com scrub do usuário

    const { lat, buf } = stat();
    if (st.baselineLat == null && isFinite(lat) && lat > 0) st.baselineLat = lat;
    if (!isFinite(lat) || lat < cfg.minLatencyGuard) return;

    // folga decai devagar de volta ao alvo quando está tudo calmo
    if (st.cushion > cfg.targetCushion) st.cushion = Math.max(cfg.targetCushion, st.cushion - cfg.decayPerTick);

    const be = bufferedEnd();
    const gap = be - video.currentTime;         // mídia baixada à frente do playhead
    // só pula se há folga baixada suficiente E buffer seguro para não estourar
    if (gap > cfg.rejumpAt && buf > st.cushion + 1) {
      video.currentTime = be - st.cushion;
      st.seeks++;
      st.lastSeekAt = performance.now();
    }
  }

  // ---- HUD na tela (só createElement/textContent — YouTube usa TrustedTypes,
  //      innerHTML lança exceção; a extensão real tem a mesma restrição) ------
  const hud = document.createElement('div');
  hud.style.cssText = [
    'position:fixed', 'z-index:2147483647', 'top:70px', 'left:12px',
    'background:rgba(0,0,0,.82)', 'color:#eee', 'font:12px/1.5 monospace',
    'padding:10px 12px', 'border-radius:8px', 'min-width:210px',
    'box-shadow:0 2px 10px rgba(0,0,0,.5)', 'user-select:none',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'ZeroDelay · protótipo';
  title.style.cssText = 'font-weight:bold;color:#fff;border-bottom:1px solid #444;padding-bottom:4px;margin-bottom:4px';
  hud.appendChild(title);

  // Uma linha "label: <valor>" com spans persistentes (atualizamos só o textContent).
  const valEls = {};
  function addRow(key, label) {
    const row = document.createElement('div');
    const l = document.createElement('span');
    l.textContent = label + ': ';
    l.style.opacity = '.7';
    const val = document.createElement('span');
    row.appendChild(l);
    row.appendChild(val);
    hud.appendChild(row);
    valEls[key] = val;
  }
  addRow('lat', 'latência');
  addRow('baseline', 'baseline');
  addRow('buf', 'buffer');
  addRow('cushion', 'folga');
  addRow('counts', 'seeks / stalls');
  addRow('state', 'catch-up');

  const btn = document.createElement('button');
  btn.textContent = 'Pausar catch-up';
  btn.style.cssText = 'margin-top:8px;width:100%;padding:4px;cursor:pointer;background:#333;color:#eee;border:1px solid #555;border-radius:5px';
  btn.onclick = () => { st.enabled = !st.enabled; btn.textContent = st.enabled ? 'Pausar catch-up' : 'ATIVAR catch-up'; btn.style.background = st.enabled ? '#333' : '#5a1e1e'; };
  hud.appendChild(btn);
  document.body.appendChild(hud);

  const fmt = (n) => isFinite(n) ? n.toFixed(1) : '—';
  function updateHud() {
    const { lat, buf } = stat();
    const playing = player.getPlayerState() === 1;
    const color = !playing ? '#f5c518' : (lat <= 12 ? '#7CFC8A' : (lat <= 16 ? '#f5c518' : '#ff8983'));
    valEls.lat.textContent = fmt(lat) + 's' + (playing ? '' : ' (pausado)');
    valEls.lat.style.color = color;
    valEls.lat.style.fontWeight = 'bold';
    valEls.baseline.textContent = st.baselineLat ? fmt(st.baselineLat) + 's' : '—';
    valEls.buf.textContent = fmt(buf) + 's';
    valEls.cushion.textContent = fmt(st.cushion) + 's';
    valEls.counts.textContent = st.seeks + ' / ' + st.stalls;
    valEls.state.textContent = st.enabled ? 'ON' : 'OFF';
  }

  st.loop = setInterval(tick, cfg.tickMs);
  updateHud();

  window.__liveSeek = {
    cfg, state: st,
    stop() {
      clearInterval(st.loop);
      video.removeEventListener('waiting', onWaiting);
      hud.remove();
      window.__liveSeek = null;
      console.log('[live-seek] parado. seeks=%d stalls=%d', st.seeks, st.stalls);
    },
  };
  console.log('[live-seek] ativo. HUD no canto superior esquerdo. window.__liveSeek.stop() para remover.');
})();
