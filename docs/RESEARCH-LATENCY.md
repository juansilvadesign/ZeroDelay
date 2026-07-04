# Pesquisa de latência — ZeroDelay

> Engenharia reversa do player de live do YouTube e lista priorizada de técnicas para
> reduzir a latência ao mínimo tecnicamente possível.
>
> Metodologia: leitura do código da extensão (`inject.js`, `engine/controller.js`,
> `common.js`) + investigação ao vivo via Claude‑in‑Chrome em uma live real
> (`v=1uGYiTSBqJM`, notícia 24/7) + referências externas (docs YouTube, LL‑DASH/LL‑HLS,
> projetos SABR de terceiros). Data: 2026‑07.

---

## 1. Contexto

A extensão hoje reduz latência de um jeito só: acelera a reprodução
(`player.setPlaybackRate(1.25)`) enquanto há buffer sobrando, consumindo o buffer e
puxando o playhead em direção ao tempo real; ao chegar no alvo, descansa em 1.0x (que
*segura* a latência sem deixá‑la voltar a crescer). É correto e validado, mas ataca
**apenas uma** das várias fontes de latência. Este documento mapeia **todas** as fontes,
mede quanto cada uma pesa, e classifica cada técnica por potencial real.

> **⚠️ CORREÇÃO IMPORTANTE (2ª rodada de pesquisa, medido ao vivo).** A conclusão inicial
> abaixo ("só ~5‑8s são reduzíveis") estava **ERRADA**. Um experimento ao vivo provou que
> **~16s são reduzíveis** (23,8s → 8,0s). Veja a **§0 — Descoberta principal**. O resto do
> documento fica como registro do raciocínio, mas a §0 é o que vale.

---

## 0. DESCOBERTA PRINCIPAL — "seek para dentro do buffer já baixado" (medido ao vivo)

> **STATUS: pesquisado e prototipado, NÃO adotado.** A técnica foi implementada no
> `engine/controller.js`/`inject.js` e validada ao vivo (23s→~10s), mas **revertida a pedido**
> — a extensão segue com o catch-up por `playbackRate` (1.25x) apenas. O motivo da reversão
> foi de produto (comportamento do seek: micro-salto visível + risco de engasgo), não técnico.
> A evidência reproduzível continua no protótipo standalone
> [`prototype/live-seek.js`](../prototype/live-seek.js) (cole no console de uma live). Este
> registro fica como referência caso a decisão seja revista.

**Resultado (reproduzível, medido nesta live NORMAL):** um único `video.currentTime =
bufferedEnd − cushion` derrubou a latência de **23,8s → 8,0s instantaneamente** (e ~11s de
forma estável e segura). Redução de **~13‑16s**, transformando uma live "Normal" (~22‑24s)
em latência efetiva de "Low" (<12s). **Sem baixar 1 byte novo** — a mídia já estava no buffer.

**Por que funciona (o mecanismo, medido):**
- Com o vídeo tocando, o player reporta `isAtLiveHead: true` e `seekableEnd − currentTime = 0`
  (o playhead está no "fim seekável") — **mas a latência é 22s.**
- Ao mesmo tempo, `buffer_health ≈ 18s` de mídia **à frente** do playhead
  (`video.buffered.end = playhead + 18s`). Ou seja, **a mídia mais nova já baixada está só
  ~4‑8s atrás do ao vivo**, mas o player insiste em tocar 22s atrás dela.
- Isso é exatamente o `dynamicReadaheadConfig.minReadAheadMediaTimeMs = 15000` +
  `livePlayerConfig.liveReadaheadSeconds = 12` (medidos no `playerResponse`): o player
  **mantém 12‑15s de readahead e reproduz atrás dele por segurança**. Não é pipeline de
  servidor — é folga do cliente, configurável.
- `seekToLiveHead()` **não resolve** aqui (o player já se considera "at live head"; é no‑op).
  Nenhuma extensão/userscript existente faz isso — todas usam `seekToLiveHead` (no‑op) ou
  `playbackRate`. **Pular o playhead para dentro do buffer dianteiro é uma técnica nova.**

**Medições (India Today, 1080p, NORMAL, banda ~37 Mbps, relógio local sincronizado ±0,2s):**

| Fase | live_latency | buffer_health | stalls |
|---|---|---|---|
| Baseline (tocando 1.0x) | 22–24 s | 15–19 s | 0 |
| Logo após o seek (cushion 2,5s) | **8,0 s** | ~1 s | 2 (na hora do salto) |
| Estável, deixado quieto | **~11 s** | 5–9 s | 0 |
| Deriva ao longo de ~30s | 11 → ~15 s | 6–11 s | 0 |

**Trade‑offs medidos:**
- **Piso:** ~8s (agressivo, buffer fino, risco de travar) a ~11s (seguro, buffer saudável).
  Limitado pelos segmentos de 5s + cadência da rede — não dá para ir muito abaixo de ~8s
  nesta classe NORMAL.
- **Deriva de volta:** o player **reconstrói o readahead** ao longo de dezenas de segundos e
  deixa o playhead recuar → a latência sobe de novo (~11 → 15s+). **Um seek único não basta:
  é preciso SEGURAR** (ver abaixo).
- **Custo:** 1‑2 travadas breves no instante do salto se o cushion for pequeno; com cushion
  ≥ ~4s o salto foi limpo (0 travadas) e estabiliza ~11s.

**Arquitetura recomendada (o "pulo do gato"):**
1. **Catch‑up = seek para `bufferedEnd − cushion`** (não `seekToLiveHead`). Reclama ~15s de
   uma vez, de graça (mídia já baixada). Cushion adaptativo (~3‑5s) conforme a saúde da rede.
2. **Segurar = re‑seek periódico** (empurrãozinho a cada ~10‑15s de volta para dentro do
   buffer) para combater a deriva — mantendo a aceleração 1.25x como está, só para o
   micro‑ajuste. Alternativa mais limpa e mais arriscada: **patch do
   `livePlayerConfig`/`dynamicReadaheadConfig`** no `playerResponse` antes da criação do
   player (baixar `liveReadaheadSeconds`/`minReadAheadMediaTimeMs`), fazendo o player nascer
   perto do ao vivo — técnica já comprovada em campo pelo userscript *"Smooth YouTube
   livestream"* (patcha `serializedExperimentFlags`).
3. **Guarda de stall obrigatória** (o watchdog `on_video_waiting` já existe): se travar,
   aumentar o cushion.

**Classificação: ALTO POTENCIAL, comprovado.** É um ganho de ordem de grandeza (~3x menos
latência), não incremental, e usa só APIs do próprio player (sem rede nova, sem SABR, sem
PO Token, sem bypass de anúncio).

**Contexto que morreu na pesquisa (rotas fechadas):** buscar segmentos direto no CDN por
`&sq=N` retorna **HTTP 403** (PO Token, 2025/26); InnerTube fingindo `ANDROID_VR` retorna
**LOGIN_REQUIRED**; o HLS público está **~10s mais atrasado** que o caminho SABR do player.
Ou seja, "player próprio" seria mais lento **e** bloqueado — a solução vencedora é dentro do
player oficial.

---

**Conclusão inicial (SUPERADA pela §0 — mantida como registro):** a maior parte da latência de uma live
"Normal" do YouTube (**~16‑17s de ~23s medidos**) é **do lado do servidor** — encode,
ingest, empacotamento em segmentos de 5s e CDN — e é definida pelo **broadcaster** no
momento do ingest (classe `NORMAL` / `LOW` / `ULTRALOW`), **não pode ser mudada pelo
espectador**, e portanto é **irredutível** por qualquer extensão. A latência que uma
extensão *pode* atacar é só a parcela do cliente: **~5‑8s** (posição do playhead atrás
da borda + buffer + decode/render). A extensão atual já captura boa parte disso. Os
ganhos adicionais viáveis são **incrementais** (segundos), não ordens de grandeza — e o
maior deles é **atacar a latência por *seek*, não só por *playbackRate***.

> Nota: o erro da conclusão inicial foi confundir `seekableEnd` (que acompanha o playhead
> nesta SABR live, dando gap ~6s) com a mídia realmente baixada (`video.buffered.end`, ~15s
> à frente). A latência reduzível é a segunda, muito maior.

---

## 2. Decomposição da latência (onde cada ms vive)

Medições ao vivo (stream SABR, VP9 itag 248, 1080p30, banda ~37 Mbps, `latency_class: NORMAL`, `live: dvr`):

| Sinal medido | Valor | Fonte |
|---|---|---|
| `live_latency_secs` (tocando) | ~23 s | `getStatsForNerds()` |
| `getVideoStats().lat` | 21.25 s | API interna |
| `buffer_health_seconds` | 15.6 s | buffer baixado à frente do playhead |
| `seekableEnd − currentTime` | ~6.4 s | playhead atrás da borda "disponível" |
| `targetDurationSec` (segmento) | **5 s** | `streamingData.adaptiveFormats` |
| Cadência de fetch SABR | ~5 s/req, ~1‑2 MB | resource timing |

Decomposição aproximada dos ~23s:

```
[ Câmera/Encoder ] -> [ Ingest RTMP/HLS ] -> [ Transcode + empacotamento (segmentos 5s) ] -> [ CDN googlevideo ] -> | -> [ Rede até você ] -> [ Buffer do player ] -> [ Playhead atrás da borda ] -> [ Decode + render ]
 \___________________________ SERVIDOR (broadcaster define a classe) ~16-17s ____________________________________/     \_________________________ CLIENTE ~5-8s (o que dá pra atacar) _______________________________/
```

- **Parcela do servidor (~16‑17s, irredutível pelo cliente):** determinada pela classe
  de latência escolhida pelo broadcaster. `NORMAL` = 15‑60s; `LOW` = 5‑15s; `ULTRALOW` =
  2‑5s. Segmentos de 5s são a assinatura de `NORMAL`. `ULTRALOW` usa chunks ~1s e CMAF
  chunked‑transfer, mas **não suporta 4K, 1440p nem DVR**. A classe é fixada no ingest e
  **não muda depois que a transmissão começa**.
- **Parcela do cliente (~5‑8s, atacável):**
  1. `seekableEnd − currentTime` (~5‑6s): quão atrás da borda disponível o playhead está.
  2. `buffer_health` além do mínimo seguro: buffer que o player insiste em manter.
  3. Decode + render (~1‑2 frames, dezenas de ms): efetivamente irredutível.

---

## 3. Evidências dos experimentos ao vivo

1. **É SABR ("manifestless"), não DASH/HLS clássico.** As requisições de mídia são
   `POST /videoplayback?...&sabr=1&live=1&hang=1&noclen=1&alr=yes`. `hang=1` = long‑poll
   (o servidor segura a conexão até ter dados); `noclen=1` = streaming sem
   content‑length. O corpo é um protobuf (`VideoPlaybackAbrRequest`) em que o **cliente
   informa o que já tem** e o **servidor decide o que liberar**. `hlsManifestUrl` existe,
   `dashManifestUrl` não; `serverAbrStreamingUrl` presente.
2. **Segmentos de 5s + cadência de 5s.** Uma requisição por ~5s, cada uma segurando ~5s
   até completar. Confirma classe `NORMAL` e que não há entrega sub‑segmento aqui.
3. **`seekToLiveHead()` funciona e é instantâneo.** Num teste, pulou o playhead ~106s
   para a borda, `isAtLiveHead` virou `true`, **0 stalls** (medido; a aba estava pausada
   por throttle de background, então o número de stall é otimista — ver §7).
4. **Flags de experimento não ajudam.** 962 flags em `ytcfg.EXPERIMENT_FLAGS`; nenhuma
   expõe tuning de latência/buffer/readahead para o espectador. O comportamento
   low‑latency hoje é **server‑driven** via SABR, não flag de cliente.
5. **APIs internas do player disponíveis** (no `#movie_player`): `seekToLiveHead`,
   `requestSeekToWallTimeSeconds`, `seekToStreamTime`, `prefetchJumpAhead`,
   `getProgressState`, `getStatsForNerds`, `getVideoStats`, `isAtLiveHead`,
   `getPlaybackRate/setPlaybackRate`.

---

## 4. Análise por fonte de latência

Para cada uma: **causa · inevitável? · contorno · lógica interna do YT · flags/APIs ·
técnica de outros players · classificação**.

### 4.1 Classe de latência (NORMAL/LOW/ULTRALOW) e tamanho de segmento
- **Causa:** o broadcaster escolhe a classe no ingest; segmentos de 5s (NORMAL) impõem
  um piso estrutural — o cliente não pode obter mídia com granularidade menor que o
  segmento empacotado.
- **Inevitável?** Sim, para o espectador. Definido no servidor, imutável durante a live.
- **Contorno:** nenhum do lado do cliente. Só o broadcaster reconfigura.
- **Lógica interna do YT:** `latency_class` em `getVideoStats()`; a classe governa todo o
  pipeline de empacotamento.
- **Flags/APIs:** nenhuma exposta ao espectador.
- **Outros players:** LL‑HLS (partial segments) / LL‑DASH (chunked CMAF) reduzem isto —
  mas **só funcionam se o servidor publicar chunks parciais**, o que YT `NORMAL` não faz.
- **Classificação: Impossível** (do lado do cliente). É a maior fatia da latência e está
  fora de alcance.

### 4.2 Posição do playhead atrás da borda (`seekableEnd − currentTime`)
- **Causa:** o player começa a tocar alguns segundos atrás da última mídia disponível,
  por segurança contra stall.
- **Inevitável?** Não — é a **principal parcela atacável** (~5‑6s).
- **Contorno:** `seekToLiveHead()` puxa o playhead para a borda instantaneamente. A
  extensão atual só faz isso em "skip" quando `latency ≥ 30s` (`skip_if_over_threshold`,
  [inject.js:170](../inject.js#L170)) ou sob comando manual. Um **seek de catch‑up
  contínuo** (não só acima de 30s) captura esses segundos que o `playbackRate` a 1.25x
  leva ~10‑12s para trimar.
- **Lógica interna do YT:** `isAtLiveHead()`, `getProgressState().seekableEnd`.
- **Flags/APIs:** `seekToLiveHead`, `requestSeekToWallTimeSeconds`, `seekToStreamTime`.
- **Outros players:** hls.js `liveSyncPosition` / `maxLiveSyncPlaybackRate` — combinam
  seek para live‑edge + rate. Exatamente o híbrido recomendado.
- **Classificação: Alto potencial** (o maior ganho novo realista).

### 4.3 Estratégia de buffering (quanto buffer o player mantém)
- **Causa:** `buffer_health` mantém segundos à frente para absorver jitter. Hoje o
  controller mira `bufferTarget` (3.5‑8s) e o modo `auto` adapta 4‑9s.
- **Inevitável?** Parcialmente. Um piso é necessário contra stall; o excesso é atacável.
- **Contorno:** já é o núcleo da extensão. Espaço extra: baixar o alvo mínimo do modo
  "min" com guarda mais fina (ver §6), e usar a **derivada do buffer** (`drain_ema`, já
  existe em [controller.js:69](../engine/controller.js#L69)) para descer mais perto da
  borda quando a conexão está estável.
- **Lógica interna do YT:** o player tem seu próprio "readahead" mínimo via SABR; não é
  exposto/ajustável.
- **Flags/APIs:** nenhuma de cliente.
- **Outros players:** Shaka `bufferingGoal`/`rebufferingGoal`; hls.js `liveSyncDuration`.
- **Classificação: Médio potencial** (a extensão já colhe a maior parte).

### 4.4 PlaybackRate (velocidade de catch‑up)
- **Causa:** taxa fixa 1.25x. Medido: ~0.5s de latência trimada por segundo a 1.5x; a
  1.25x é mais lento porém suave.
- **Inevitável?** Não — é ajustável.
- **Contorno:** **rate adaptativo** proporcional a quão acima do alvo o buffer está
  (ex.: 1.15x quando pouco acima → até 1.6x quando muito acima), em vez de 1.25x fixo.
  Trima mais rápido com a mesma margem de segurança. Cuidado com áudio: acima de ~2x o
  pitch‑correction do YT degrada; manter teto ~1.5‑1.6x.
- **Lógica interna do YT:** o próprio YT tem "catch‑up" leve em lives ULTRALOW, mas não
  exposto.
- **Flags/APIs:** `setPlaybackRate` (aceita taxas arbitrárias; confirmado que "gruda" em
  SABR, ao contrário de `video.playbackRate`).
- **Outros players:** hls.js `maxLiveSyncPlaybackRate` faz rate adaptativo por distância
  à borda — mesma ideia.
- **Classificação: Médio potencial.**

### 4.5 SABR / interceptar requisições de mídia
- **Causa:** o servidor decide quanta mídia liberar (long‑poll `hang=1`); o cliente só
  informa o que tem.
- **Inevitável?** A liberação é server‑side. Interceptar/reescrever o protobuf **não faz
  o servidor liberar além da janela de empacotamento** dele.
- **Contorno:** teoricamente reescrever `bufferedRanges`/tempo pedido no POST para pedir
  mais perto da borda — mas o efeito é o mesmo de `seekToLiveHead` (§4.2), com muito mais
  fragilidade (protobuf muda sem aviso, quebra a cada atualização do player). Não vale.
- **Lógica interna do YT:** `SabrUmpProcessor` no player monta o corpo; formato
  `application/vnd.yt-ump`.
- **Flags/APIs:** nenhuma estável.
- **Outros players:** projetos como `yt-sabr-shaka-demo` reimplementam SABR sobre Shaka —
  para *tocar* fora do YT, não para *reduzir* latência abaixo do que o YT já faz.
- **Classificação: Baixo potencial** (alto risco, ganho ≈ o do seek, muito mais frágil).

### 4.6 Player custom (parsear HLS/DASH e tocar por conta própria)
- **Causa:** hipótese de trocar o player do YT por um LL‑HLS/LL‑DASH próprio.
- **Inevitável?** —
- **Contorno:** `hlsManifestUrl` existe. Mas em `NORMAL` o HLS do YT entrega os mesmos
  segmentos de 5s, **sem partial segments** — um player custom não teria fonte
  low‑latency para consumir. Além disso, MV3 proíbe código remoto, DRM/`n`‑sig
  complicam, e reimplementar SABR é enorme.
- **Classificação: Impossível/Inviável** (não há fonte mais granular para consumir; custo
  altíssimo, ganho nulo sobre §4.2).

### 4.7 Escolha automática de qualidade
- **Causa:** qualidade alta = segmentos maiores = mais tempo de download → mais risco de
  ter de manter buffer maior.
- **Inevitável?** Não.
- **Contorno:** em conexões fracas, **baixar a resolução** encurta o download por
  segmento e permite sentar mais perto da borda com menos rebuffer. Trade‑off de
  qualidade → deveria ser opt‑in (ex.: "priorizar latência sobre nitidez" no modo min).
- **Flags/APIs:** `player.setPlaybackQualityRange()`.
- **Classificação: Baixo/Médio potencial** (ajuda indiretamente, custo de qualidade).

### 4.8 Latência de rede / prefetch / preload
- **Causa:** RTT até o CDN googlevideo + estabelecimento de conexão.
- **Inevitável?** Em grande parte. RTT é físico.
- **Contorno:** o YT já usa keep‑alive (`keepalive=yes`) e long‑poll; conexão já é
  reaproveitada. `prefetchJumpAhead` existe mas é para seeks de VOD. Pouco a ganhar.
- **Classificação: Baixo potencial.**

### 4.9 Decode / render pipeline
- **Causa:** decodificação VP9 + composição de 1‑2 frames.
- **Inevitável?** Sim (dezenas de ms). Trocar codec (av01/h264) não muda latência
  perceptível.
- **Classificação: Impossível/irrelevante** (ordem de ms, não segundos).

### 4.10 Atualização de manifesto / eventos internos do player
- **Causa:** em SABR não há refresh periódico de manifesto (é manifestless); a borda
  avança pela resposta do long‑poll.
- **Contorno:** nada a fazer — não é gargalo aqui.
- **Classificação: Impossível/irrelevante.**

---

## 5. Lista priorizada de técnicas viáveis

| # | Técnica | Potencial | Ganho estimado | Esforço | Risco |
|---|---|---|---|---|---|
| 1 | **Catch‑up híbrido seek+rate**: usar `seekToLiveHead()` para engolir o gap `seekableEnd−current` de uma vez, depois `playbackRate` só para o ajuste fino, com guarda de stall | **Alto** | ~4‑6s a menos no tempo de convergência + piso mais baixo | Médio | Médio (salto visível / stall) |
| 2 | **PlaybackRate adaptativo** (1.15→~1.6x proporcional ao excesso de buffer) em vez de 1.25x fixo | Médio | Convergência ~2x mais rápida | Baixo | Baixo |
| 3 | **Alvo de buffer guiado por derivada**: descer mais perto da borda quando `drain_ema` estiver estável/positivo | Médio | ~1‑2s no piso, sem mais stalls | Baixo | Baixo |
| 4 | **Modo "priorizar latência"** que baixa a resolução em conexões fracas | Baixo/Médio | Permite modos agressivos em internet ruim | Médio | Baixo (custo de qualidade) |
| 5 | Rebaixar `skipThreathold` do skip‑to‑live e/ou torná‑lo adaptativo (hoje 30s fixo) | Médio | Recupera rápido após stall grande | Baixo | Baixo |
| 6 | Interceptar/reescrever protobuf SABR | Baixo | ≈ técnica 1, mais frágil | Alto | Alto |
| 7 | Player custom LL‑HLS/DASH | Impossível | 0 sobre a técnica 1 | Altíssimo | Alto |

**Recomendação:** implementar **1 → 2 → 3** nessa ordem. Juntas atacam toda a parcela do
cliente (~5‑8s) mais rápido e com piso mais baixo, sem reescrever a arquitetura. As demais
têm relação custo/benefício ruim.

---

## 6. O que é impossível (e por quê, tecnicamente)

- **Baixar a latência abaixo do piso da classe do broadcaster.** ~16‑17s dos ~23s são
  encode+ingest+empacotamento(5s)+CDN, fixados pela classe `NORMAL` no ingest e imutáveis
  durante a live. O espectador não tem knob para isso. **Demonstração:** os segmentos
  chegam com `targetDurationSec:5` e a cadência de fetch é ~5s; nenhuma API/flag de
  cliente altera o empacotamento; `latency_class` é read‑only.
- **Obter mídia mais granular que o segmento.** Em `NORMAL` não há partial segments
  (LL‑HLS) nem chunked CMAF (LL‑DASH) publicados; um player custom não teria o que
  consumir. **Demonstração:** `hlsManifestUrl` do YT `NORMAL` lista segmentos de 5s.
- **Forçar o servidor a liberar além da janela de empacotamento via SABR.** `hang=1` já
  entrega assim que há dados; reescrever o POST não cria mídia que ainda não existe.
- **Reduzir decode/render de forma perceptível.** Dezenas de ms, dominados pelo hardware.

---

## 7. Recomendações concretas de implementação

Alterações ficam concentradas em **`engine/controller.js`** (matemática, testável) e
**`inject.js`** (aplicar seek). Sem quebrar as chaves de storage (§ `common.js:118`).

- **Técnica 1 — híbrido seek+rate.** Hoje o seek só ocorre em
  [`skip_if_over_threshold`](../inject.js#L170) (latency ≥ 30s) e no comando manual
  [`seek_to_live`](../inject.js#L181). Adicionar um caminho de catch‑up por seek quando
  `progress_state.seekableEnd − current` exceder um limiar pequeno (ex.: 1.5× o segmento)
  **e** o buffer estiver saudável, respeitando o watchdog de stall
  ([`on_video_waiting`](../inject.js#L308)). Preferir seek para o "grosso" e rate para o
  "fino". Expor o controle de decisão no controller (ex.: `calcSeekTarget(...)`) para ser
  unit‑testado como o `calcPlaybackRate` já é.
- **Técnica 2 — rate adaptativo.** Em [`calcPlaybackRate`](../engine/controller.js#L62),
  retornar taxa proporcional a `(buffer_ema − target)` com teto ~1.6x, em vez do `speed`
  fixo. Manter todas as guardas (`BUFFER_FLOOR`, `accel_allowed_by_buffer`, `DRAIN_BRAKE`).
- **Técnica 3 — alvo por derivada.** `drain_ema` já é calculado
  ([controller.js:69](../engine/controller.js#L69)); usá‑lo para permitir descer o alvo
  efetivo quando `drain_ema ≥ 0` de forma sustentada (conexão folgada), e travar a descida
  quando negativo. O modo `auto` já faz algo parecido em
  [`auto_buffer_target`](../engine/controller.js#L48) — estender a mesma ideia aos modos
  fixos como piso dinâmico.

### Verificação (end‑to‑end)
1. **Testes unitários primeiro:** estender `test/controller.test.mjs` para o novo
   `calcSeekTarget` e o rate adaptativo (o controller é puro, roda sem browser).
2. **Live real em aba EM PRIMEIRO PLANO e foco** (abas em background sofrem throttle de
   mídia/timers e pausam — visto nesta pesquisa). Via Claude‑in‑Chrome:
   comparar `getVideoStats().lat` e `buffer_health_seconds` antes/depois, contar eventos
   `waiting` (stalls) numa janela de 5‑10 min, em conexões boa e limitada.
3. **Critério de aceite:** latency final ≤ hoje **e** número de stalls não maior, nos
   modos `auto`, `balanced` e `min`.

---

## Fontes

- [Understand live streaming latency — YouTube Help](https://support.google.com/youtube/answer/7444635?hl=en)
- [YouTube Live Stream Latency Explained — YTStreamer](https://ytstreamer.com/live-stream-latency/)
- [Low Latency Live Streaming in DASH and HLS (ACM)](https://dl.acm.org/doi/pdf/10.1145/3503161.3548544)
- [Fundamentals of LL-DASH and LL-HLS — Bitmovin](https://developer.bitmovin.com/playback/docs/fundamentals-of-ll-dash-and-ll-hls)
- [yt-sabr-shaka-demo (LuanRT)](https://github.com/LuanRT/yt-sabr-shaka-demo) · [kira (LuanRT)](https://github.com/LuanRT/kira)
