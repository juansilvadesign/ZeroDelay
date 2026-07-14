# Changelog

Todas as mudanças relevantes deste projeto são documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e o projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado

- **"Copiar diagnóstico"** no painel avançado do popup: copia um JSON com os
  últimos ~2 minutos do motor (latência, buffer e velocidade aplicada, 1
  amostra/s), as capacidades detectadas do player, o estado do controlador, o
  modo e as configurações — pronto para colar num relatório de bug (o template
  de issue já traz o espaço). 100% local: nada é coletado nem enviado; o dado
  só existe na memória da aba e só sai do navegador se você mesmo colar.
- **"Resumo da sessão"** ao lado do diagnóstico: copia um texto curto e
  compartilhável com o tempo assistido, o atraso recuperado pelo catch-up, os
  pulos para o ao vivo, as travadas e a latência média da live atual.
- **Latência no ícone da extensão** (opt-in, junto aos indicadores): a latência
  atual da live vira o badge do ícone na barra — dá para conferir se você está
  no ao vivo sem abrir o popup. Por aba (cada live mostra a sua), em cinza
  neutro para não parecer alerta, e só atualiza quando o número muda. Nova
  chave de storage `showBadge` (padrão: desligado).
- **Aviso de novidades no popup**: depois de uma atualização, um chip discreto
  aponta para o CHANGELOG até ser lido ou dispensado — as melhorias quase
  diárias deixam de ficar escondidas no repositório (parte da issue #27).
  Instalação nova não mostra nada. Nova chave local `lastSeenVersion`.

### Corrigido

- PIX só aparece agora quando a interface do navegador está em português do
  Brasil (`pt-BR`). Antes, bastava ter "Português (Brasil)" em qualquer posição
  da lista de idiomas aceitos do navegador para o QR do PIX aparecer, o que
  exibia o PIX (inútil sem CPF e conta no Brasil) para quem está fora do país,
  por exemplo usuários de Portugal que adicionam pt-BR por causa de conteúdo
  dublado. Quem não está com a interface em pt-BR vê o link internacional (Buy
  Me a Coffee). Reportado em #50.
- **Firefox/Gecko: reduz risco de áudio adiantar ao acelerar lives**: o motor
  agora aplica a velocidade por um adaptador testado que mantém cada degrau por
  um curto intervalo no Gecko, volta para `1.0x` imediatamente ao descansar e
  sincroniza o `<video>` com o eco real do player do YouTube. Isso evita rajadas
  de microajustes de velocidade durante o catch-up em lives, mirando a issue #40.

## [1.4.0] - 2026-07-07

### Adicionado

- **Convite de doação dentro do player (Brasil)**: no lugar do banner simples,
  quem está no Brasil vê um "motion" discreto no canto do player, no estilo dos
  gráficos de transmissão. Uma bolinha de futebol rola da lateral, quica no canto
  e abre um cartão "Apoie o ZeroDelay" com um QR Code do PIX (sem valor definido).
  É pequeno (92 px), some sozinho em poucos segundos, sai da frente dos controles
  e funciona em tela cheia. Aparece uma vez por sessão, num momento calmo (com a
  transmissão estável) e só para quem já usou a extensão por um tempo. Segue 100%
  client-side: PIX estático, sem servidor e sem coleta de dados. O banner de uso
  comum continua para os demais casos (e não aparece em tela cheia).
- **"Temperatura" dos modos** (ideia e implementação de
  [@leandroohsr](https://github.com/leandroohsr), **PR #41**): cada modo ganha um
  accent próprio que esquenta em direção ao vermelho do "ao vivo" conforme fica
  mais agressivo, com a rampa clara correta nos temas claro e escuro.

### Alterado

- **Valores de doação ancorados um pouco mais para cima**: o menor preset passa a
  ser R$ 2 e o padrão selecionado é R$ 5 (presets de 2, 5, 10 e 25).
- **Freio anti-travamento mais conservador**: agora ele só desacelera quando o
  buffer está genuinamente fino e ainda caindo, com um piso mais suave (0.95x) e
  imperceptível. Se um empurrão gentil não resolve, ele deixa a rede se recuperar
  em vez de arrastar o vídeo para baixo. No simulador, empata ou melhora frente à
  1.3.0 em todos os cenários.

## [1.3.0] - 2026-07-06

### Adicionado

- **Modo "Personalizado"**: um novo modo (o último da lista, abaixo do Extremo)
  em que você define o **buffer alvo num slider de 1 a 6 s**. Diferente dos
  outros, ele **regula o buffer em torno do alvo tocando abaixo de 1.0x para
  recompor o colchão** quando a conexão oscila — algo que nenhum modo fazia (os
  demais só aceleram ou descansam em 1.0x, torcendo para a rede reabastecer).
  Isso sustenta alvos mais agressivos (mais perto do ao vivo) do que um modo
  comum. A física por trás: só dá pra ter bufferizado o que já foi publicado à
  frente do playhead (`buffer <= latência − piso de pipeline`), então ficar um
  pouco mais atrás do ao vivo é o que abre espaço para o colchão encher. Alvos
  confortáveis estacionam sem travar (validado no `scripts/sim-live.mjs`); alvos
  bem finos (1-2 s) trocam estabilidade por proximidade e podem travar — a
  escolha é sua. Usa chaves de storage novas (`band`, `centerBuffer`), sem
  renomear as existentes; os modos existentes (inclusive o Suave) não mudam.
  Baseado na ideia do modo **"Estável"** da PR #37 de
  [@RobertoMarconi](https://github.com/RobertoMarconi) — a recomposição abaixo de
  1.0x e o slider de alvo.

### Alterado

- **Freio anti-travamento em todos os modos**: o controlador clássico (usado por
  Automático, Equilibrado, Próximo e Extremo) agora, quando o buffer afina para a
  zona de perigo, **toca abaixo de 1.0x para recompor o colchão** em vez de só
  descansar em 1.0x torcendo para a rede reabastecer. O freio só dispara com o
  buffer fino, então os modos confortáveis não mudam em nada, mas os agressivos
  ficam bem mais difíceis de travar: no `scripts/sim-live.mjs` o **Próximo cai de
  ~15 para ~1 travada** em 30 min, e sob conexão ruim de ~31 para 0. É a mesma
  técnica do modo Personalizado, agora protegendo a lista inteira.
- **Modos agressivos colam mais no ao vivo**: a histerese e o backoff do
  controlador clássico agora escalam com o alvo do modo, então os modos de buffer
  baixo rastreiam de perto o alvo em vez de flutuar bem acima dele. O **Extremo**
  passa a entregar os ~2s de buffer que anuncia (antes segurava ~3,2s) e cai de
  ~9s para **~7s de latência** (colado no ao vivo), ao custo de algumas travadas a
  mais — o esperado de um modo agressivo. Os modos calmos (Equilibrado,
  Automático) não mudam.
- **Medidor de "proximidade do ao vivo" no chip de cada modo**: no lugar do ícone
  estático, cada modo mostra um marcador num trilho cuja ponta direita é a borda
  vermelha fixa do ao vivo; o marcador desliza em direção a ela conforme o modo
  fica mais perto do ao vivo (o Extremo quase encosta). O Automático deriva
  (animado, parado sob `prefers-reduced-motion`) e o **Personalizado acompanha o
  slider**. Decorativo (`aria-hidden`); o texto "buffer ~Xs" segue com o número.
  Ideia de [@leandroohsr](https://github.com/leandroohsr) (PR #35).

### Removido

- **Modo "Suave"**: removido. Com o freio agora em todos os modos, um modo
  dedicado a "mais buffer / estabilidade" deixou de ser necessário — o Automático
  já mantém um colchão folgado e se adapta, e o Personalizado cobre qualquer alvo
  de buffer com o mesmo freio. Menos modos na lista (de 7 para 6). Quem tinha o
  Suave lembrado para um canal apenas volta a não ter preferência salva ali; nada
  quebra.
- **Modo Hexa** removido: o tema verde-amarelo da Copa (reskin do player nos jogos
  do Brasil, detecção de gol pela explosão do chat, bandeira no logo, os toggles no
  popup e o atalho `Alt+Shift+H`) foi retirado agora que o Brasil saiu da Copa. O
  código fica preservado na branch `archive/modo-hexa` e pode voltar num próximo
  torneio. A memória de modo por canal, que usava o mesmo evento do player, segue
  intacta.

## [1.2.3] - 2026-07-05

### Adicionado

- **Tema claro/escuro no popup**: um botão no header, ao lado do "Apoiar",
  alterna entre os temas claro e escuro. Sem escolha salva, o popup segue o tema
  do sistema, como antes; a escolha fica na chave nova `themePref`, fora do
  estado do motor, então "Restaurar padrões" preserva o tema. Nos quatro
  idiomas. Contribuição de [@leandroohsr](https://github.com/leandroohsr)
  (PR #34).
- **Botões "Sobre o ZeroDelay" e "Relatar um problema"**: dois links no rodapé
  do popup levam ao repositório e às issues no GitHub, criando um caminho direto
  da extensão para a comunidade. Nos quatro idiomas. Contribuição de
  [@leandroohsr](https://github.com/leandroohsr) (PR #32).

### Alterado

- **Documentação de desenvolvimento em inglês**: README, CONTRIBUTING,
  CODE_OF_CONDUCT, SECURITY, ROADMAP, CONTRIBUTORS e docs/firefox.md foram
  traduzidos para o inglês para abrir o projeto à comunidade internacional,
  contribuição de [@leandroohsr](https://github.com/leandroohsr) (PR #33).
  O README continua disponível em português em `README.pt-BR.md`, com seletor
  de idioma no topo.
- **Suporte de desenvolvimento ao Zen Browser**: novo script `npm run run:zen`
  que carrega o build Firefox/Gecko no Zen via `web-ext`, resolvendo o binário
  por `ZEN_BINARY`/`PATH` e com perfil opcional por `ZEN_PROFILE`. Apenas
  tooling local, sem alteração no código publicado nem nos manifestos.
  Contribuição de [@GbrFrn](https://github.com/GbrFrn) (PR #26).

## [1.2.2] - 2026-07-04

### Adicionado

- **Seção "Ajuda · Como usar" no popup**: uma seção retrátil (fechada por padrão,
  irmã de "Avançado") com um FAQ curto para quem acabou de instalar — o que a
  extensão faz, como começar, por que a velocidade muda sozinha, qual modo
  escolher, o que são os números no player e os atalhos de teclado. Reaproveita os
  componentes e as cores existentes e está nos quatro idiomas (`en`, `pt_BR`,
  `es`, `fr`).

- **Memória de modo por canal (opt-in)**: um toggle **"Lembrar modo por canal"**
  (desligado por padrão) guarda o modo que você escolhe em cada canal do YouTube e
  reaplica ao voltar. Nunca sobrepõe o seu modo atual num canal sem preferência
  salva; o popup mostra **"lembrado para este canal"** com um **"esquecer"**.
  Baseado na ideia da PR #22 de [@wthallys](https://github.com/wthallys).

### Corrigido

- **Travamentos com o rate preso em 1.05x (regressão da v1.2.0)**: o controlador
  contínuo tinha perdido o `bufferTarget` como piso de descanso e moía o buffer
  até o limite de travamento (1.5s), segurando ~1.05x sem margem nenhuma até a
  live travar, em todos os modos, sempre que a latência mínima real da stream
  fica acima de ~2s (toda live de verdade). O alvo de buffer do modo voltou a
  ser o ponto de equilíbrio, com as três salvaguardas do controlador original
  restauradas (histerese de engate, backoff instantâneo em 2.5s e freio
  preditivo de drenagem da issue #12), mantendo a aceleração contínua.
  Diagnóstico confirmado ao vivo na CazeTV e por simulação (52-58 travamentos
  em 30 min antes; 0 depois, nos modos suave/equilibrado/automático).
- **Motor se auto-bloqueava achando que era o usuário**: o player do YouTube
  quantiza `setPlaybackRate` em passos de 0.05 (pedir 1.0375 aplica 1.0; 1.06
  aplica 1.05). Os rates contínuos do controlador novo divergiam do eco
  quantizado e o detector de "usuário mudou a velocidade" congelava o controle
  com a live presa em 1.05x, inclusive com o buffer morrendo. Agora o motor
  pede rates já no grid de 0.05 e adota o eco do player como valor aplicado.
- **Motor dormia em aba minimizada**: o loop era um `setInterval` puro, que o
  Chrome estrangula em aba escondida (1 tick/s, e 1 tick/min após 5 minutos sem
  áudio) — sem catch-up, sem skip e com os indicadores defasados até voltar. O
  tick agora é dirigido pelo `timeupdate` do vídeo (imune ao throttle enquanto
  a mídia toca) com resync imediato ao voltar pra aba.
- **Avisos só em lives**: tanto a oferta de "a transmissão está travando" quanto o
  convite de doação agora só aparecem enquanto uma **live está tocando de verdade**
  — nunca em VOD/replay nem numa aba ociosa.
- **Falso positivo do aviso de travamento em anúncios**: o watchdog de travamento
  ignora o evento `waiting` disparado enquanto um **anúncio** roda (buffa no mesmo
  `<video>`), então não sugere mais trocar de modo por causa de propaganda.
- **Watchdog de travamento zera a contagem ao trocar de live**: a contagem de
  travadas é reiniciada a cada transmissão, junto com o resto do estado do motor
  (EMAs/histerese, `seekableEnds`). Antes ela era global e sobrevivia à navegação
  SPA — uma travada numa live somava com outra na live seguinte (ao trocar de
  canal em até 90s) e disparava a oferta de "trocar para um modo mais calmo" sem
  que nenhuma das duas tivesse travado de verdade duas vezes. O recuo anti-repetição
  (não reoferecer por ~5min) é mantido de propósito.

### Alterado

- **Convite de apoio: presença por sessão e silêncio só por escolha explícita**:
  enquanto o usuário não decidir, o convite aparece uma vez por sessão do
  navegador (e só sobre uma live tocando de verdade). **"Hoje não"** silencia
  até o dia virar; **"Não quero apoiar"** silencia para sempre; **"Apoiar"**
  abre a doação. Ver o convite ou fechá-lo no ✕ não arma silêncio nenhum. Os
  dois botões de escolha existem no banner sobre a live e no popup, e o botão
  de apoio no header do popup segue sempre disponível.

### Segurança

- **Blindagem preventiva do SVG do popup**: a função que converte o markup dos
  ícones e do QR PIX em nós DOM agora rejeita raízes scriptáveis e remove
  `<script>`/`<foreignObject>` aninhados, handlers inline (`on*`) e URLs
  `javascript:`/`data:` de `href`/`src`. Hoje só markup próprio passa por ali
  (nenhuma falha explorável existia); a mudança garante que uma alteração
  futura não transforme esse caminho em XSS.

## [1.2.1] - 2026-07-03

### Corrigido

- **Modo Hexa — a splash "OLÊ OLÊ OLÁ" e a confete de gol agora tocam mesmo com
  `reduced-motion`**. Como o Modo Hexa é **opt-in** (você ativa de propósito), essas
  festas de um-disparo, acionadas por você, deixaram de ser suprimidas pela
  preferência de movimento reduzido — só o **loop infinito** de morph da logo
  continua calmo (estático) para quem precisa.
- **Modo Hexa — blindagem anti-cascata**: cada nó decorativo (badge, varal, botão
  GOL, logo) é montado isolado, então uma falha em um não derruba mais os outros
  nem o `keepAlive`; a funcionalidade sobe antes do boot/toast cosméticos; e cada
  falha vira um aviso `[ZeroDelay Hexa] <função> falhou:` no console (auto-diagnóstico).

## [1.2.0] - 2026-07-03

### Adicionado

- **Modo Hexa — logo do YouTube vira bandeira do Brasil**: o símbolo do "play"
  na masthead se transforma, em **loop com descanso** (~24s: a maior parte do
  tempo como bandeira, um breve retorno ao YouTube), numa **bandeira cartoon
  tremulando** — o campo vermelho vira verde, o **losango**, o **círculo azul** e
  as **6 estrelas do hexa** brotam em coroa por cima, e o **triângulo branco do
  play** permanece como elo entre os dois estados. Some no **gol** (a bandeira
  balança forte junto com a confete) e respeita `prefers-reduced-motion` (fica uma
  bandeira parada) e a tela cheia. Não é um adesivo por cima: é uma **troca no
  próprio SVG da logo** — escondemos só os paths do ícone e injetamos a bandeira no
  lugar exato dele, **reaproveitando o wordmark "YouTube" original** da página (nada
  é reproduzido/embutido; tudo fica no mesmo sistema de coordenadas e alinhado).
- **Modo Hexa — comemoração de GOL**: confete liberado **continuamente por ~3s**
  (não mais um único estouro). Dispara pelo botão **GOL!** e também
  **automaticamente** quando um **pico de volume no chat ao vivo** é detectado —
  um gol de verdade faz a torcida inteira postar de uma vez. Salvaguardas contra
  falso-positivo: exige um número alto de mensagens num intervalo curto **e** um
  múltiplo grande do ritmo normal do chat (um troll isolado mandando "GOL" não
  dispara), **e** que a rajada seja majoritariamente comemorativa
  (`classifyHexaChatMessage`) — para **não comemorar gol do adversário** (lamento
  no chat não conta). Cooldown de 45s entre disparos.
- **Modo Hexa — boot de ativação com o canto "OLÊ OLÊ OLÁ"**: a estrela tricolor
  estoura e **segura o tempo de você vê-la** (o gatilho), depois se abre e entrega
  um **campo amarelo** onde o grito **"OLÊ OLÊ OLÁ"** entra empilhado em verde (um
  "OLÊ" grande + grade 2×3 + as estrelas do hexa), na fonte da marca (Departure
  Mono, self-hosted também na página) — a festa da referência.
- **Modo Hexa — botão GOL! com experiência de botão nativo**: neutro/cinza como o
  like/dislike (mesmo tamanho, ícone de bola e espaçamento) e fica **dourado só ao
  marcar** (clique ou detecção de gol), com a bola **quicando e girando** como a
  reação do "gostei", voltando ao neutro em seguida.
- **Modo Hexa — o popup veste a camisa**: enquanto o tema está ativo numa aba, o
  **header do popup** ganha uma faixa verde full-bleed (o campo da seleção), uma
  linha tricolor de recorte e o selo "o" do wordmark em ouro.
- **Popup — ícones de cerveja redesenhados**: conjunto de traço padronizado
  (copo americano → lata → long neck → caneca), com a **lata** agora de verdade
  (ombro afunilando pra tampa + lacre, não mais um cilindro); o mug do header ganha
  **borbulhas subindo** (carbonatação, recuperando a antiga fumacinha do café) e os
  chips dão um "tim-tim" no hover. "R$ 10" não quebra mais linha.

### Alterado

- **Modo Hexa — repintura por padrão é ESTREITA (opt-in para a completa)**: por
  padrão o tema veste só o acento (barra do player, varal e os nós ZeroDelay), sem
  repintar o YouTube inteiro — menos ambiguidade de "isto é o YouTube real?". O
  **tema verde completo** continua existindo, agora **desligado por padrão** e
  ativável em "Tema completo no YouTube"; quando ligado, ele traz também a **borda
  verde** sob o masthead.
- **Modo Hexa — selo LIVE permanece VERMELHO nativo**: o selo "AO VIVO" do player
  não é tingido. Vermelho = "você está na borda ao vivo", que é justamente o que a
  extensão entrega — tingi-lo enterraria o único sinal que diz ao torcedor que ele
  está realmente ao vivo.
- **Modo Hexa fica totalmente inerte em tela cheia**: nenhum overlay (badge,
  varal, GOL!, confete, boot, toast, convite) e nenhum acento no player (barra)
  enquanto o vídeo está em fullscreen — tudo volta ao sair.

### Corrigido

- **Aceleração linear e contínua** no motor de catch-up. O controlador voltou a
  reduzir a latência de forma suave e proporcional ao atraso (quanto mais atrás
  do ao vivo, mais rápido, até 1.25x), em vez dos "tiros" de velocidade cheia
  seguidos de longos descansos — que demoravam muito para diminuir o atraso. O
  buffer agora é apenas uma trava de segurança suave (reduz a taxa gradualmente
  ao se aproximar do piso de travamento), não mais um liga/desliga travado no
  alvo de buffer. Removido o freio por tendência (`drain_ema`), que disparava no
  dreno normal do próprio catch-up e o interrompia no meio.
- Botão CTA **"Apoiar via PIX"** agora alterna o painel de doação (abre **e**
  fecha), em vez de apenas abrir — mesmo comportamento do botão "Apoiar".

### Removido

- **Botão "Ir ao Vivo"** do popup — destoava da interface. O atalho de teclado
  (`Alt+Shift+L`) continua pulando para o ao vivo.

## [1.1.1] - 2026-07-02

### Adicionado

- **Botão "Ir ao Vivo"**: Adicionado botão de ação rápida diretamente no popup para saltar manualmente para o tempo real da live.
- **Idiomas**: interface em espanhol (`es`) e francês (`fr`), além de inglês e
  português. A doação segue o idioma (Buy me a coffee fora do pt-BR). O
  `check:locales` agora valida todos os locales contra o `en`.
- **Atalhos de teclado** para ativar/desativar o ZeroDelay (`Alt+Shift+Y`) e
  pular para o ao vivo (`Alt+Shift+L`) — `⌘+Shift+…` no Mac —, sem abrir o popup.
  Reconfiguráveis em `chrome://extensions/shortcuts`.
- **Acessibilidade**: navegação por setas (padrão ARIA radiogroup, um único
  tab-stop) nos cartões de modo e `aria-label` nos indicadores do player.
- Suporte ao **Firefox Desktop**: `manifest.firefox.json`, build em Node e
  tooling `web-ext` (`run:firefox`, `lint:firefox`, `package:firefox`).
- Pipeline de **CI** (GitHub Actions) rodando lint, testes e build a cada push e
  pull request.
- **Testes unitários** do motor de catch-up (`node --test`).
- Tooling de release: validação (`scripts/validate.mjs`), build
  (`scripts/build.mjs`) e bump de versão (`scripts/bump.mjs`).
- Estrutura de governança: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md`, templates de issue e de pull request e este `CHANGELOG.md`.
- `CONTRIBUTORS.md` creditando os autores das PRs da comunidade.

### Alterado

- **Interface do popup repaginada** com a linguagem visual "degradado → nítido":
  tipografia **Departure Mono** (self-hosted) em títulos e números; ícones de modo
  que fazem *morph* de pixelado (**Pixelarticons**) para nítido (**Lucide**) no
  hover/foco/seleção; paleta de sinal cinza↔vermelho espelhando o selo de "ao
  vivo" do YouTube; o "o" de Zer**o**Delay como selo LIVE que morfa de pixel-art
  para um disco vermelho ao sincronizar; sistema de "sticker" com sombra dura nos
  botões; CTA de apoio como balão que sai do botão; área do PIX como cupom
  destacável com um ícone de bebida por valor; e textura de scanline que some ao
  sincronizar. Puramente visual — nenhuma mudança de comportamento, storage ou
  chaves i18n. Fontes e ícones são vendorados localmente (sem CDN) e creditados no
  `THIRD-PARTY-NOTICES.md` (Departure Mono — SIL OFL; Pixelarticons — MIT;
  Lucide — ISC).
- Maior resiliência do motor de catch-up.
- Controle de catch-up **preditivo**: além do nível do buffer, o motor agora
  observa a *tendência* (a variação do buffer ao longo do tempo) e recua para
  `1.0x` de forma preventiva quando o buffer está drenando — mesmo ainda alto —
  reduzindo travamentos em redes instáveis (issue #12).
- **Modos repaginados**: "Latência Mínima" vira **"Extremo"** (buffer ~2s) e os
  demais ficam mais perto do ao vivo (Suave 8→5, Equilibrado 6→4, Próximo
  4,5→3s). Sem novas chaves de storage.
- **Tema cerveja no apoio (Brasil)**: no `pt-BR` o convite de doação usa
  "cerveja"/"cervejinha" 🍺 (título, nota, CTA, nudge e banner) e ícones de
  bebida (copo americano → lata → long neck → caneca); os demais idiomas seguem
  café/coffee. Chips do PIX reorganizados em grade de 4 colunas com "Outro" em
  linha própria. Ramificado por idioma, como o PIX × doação internacional.

### Corrigido

- **Build**: a pasta `fonts/` (Departure Mono) passou a ser incluída no pacote
  (Chrome e Firefox). Sem isso, a fonte ficava de fora do `.zip`/`dist` e a
  tipografia da repaginação caía no fallback do sistema.

- Ícones dos modos (e demais glifos SVG do popup) não apareciam — sobrava só o
  fundo circular. Os SVG inline sem `xmlns` caíam no namespace nulo ao serem
  parseados como `image/svg+xml`; `parseSvg` agora usa `text/html`, que aplica o
  namespace SVG corretamente. O QR Code do PIX segue funcionando.
- **Firefox**: a detecção de `cloneInto` passou a ser por feature detection em
  vez de sniffing de user agent — com `privacy.resistFingerprinting` (ou UA
  alterado) a extensão ficava silenciosamente inoperante. O motor também ignora
  eventos de settings cujo `detail` não atravessou os mundos (X-ray).
- PIX restrito a `pt-BR`: usuários de `pt-PT` viam o QR do PIX (inutilizável em
  Portugal) em vez do link internacional de doação.
- O contador de uso da doação não infla mais com várias abas abertas (só uma
  aba contabiliza cada minuto de relógio).
- O atalho de ativar/desativar (`Alt+Shift+Y`) voltava a gravar "desligado" em
  dados legados (`enabled=false` sem preset completo) — agora religa na
  primeira pressão.
- O popup se mantém sincronizado com mudanças externas (atalho de teclado,
  oferta de troca de modo no player) enquanto está aberto.
- O estado do controlador de catch-up (EMAs, histerese) é zerado ao navegar
  entre lives — decisões dos primeiros segundos não usam mais dados da
  transmissão anterior.
- Indicadores não exibem mais `NaN` quando o player não reporta latência ou
  buffer; o chip de "copiar link" não gera mais URL com `v=undefined`.
- `bump.mjs` agora versiona também `manifest.firefox.json` e
  `package-lock.json`; `validate.mjs` valida os dois manifests e acusa
  divergência de versão entre eles.
- Vazamentos de memória em navegações consecutivas: listener preso ao
  `<video>` antigo quando o YouTube trocava o elemento (ex.: live → live) sem
  removê-lo; risco de listeners duplicados em `chrome.storage.onChanged` caso
  o content script fosse reinicializado na mesma aba; e uma race condition no
  `setInterval` de detecção do player quando `yt-navigate-finish` disparava em
  sequência rápida (PR #17).

### Alterado (interno)

- Pacote da Chrome Web Store gerado por **whitelist** de arquivos (como no
  build do Firefox) — um arquivo estranho na árvore não pode mais vazar no zip.
- Detecção do player com back-off (20s rápidos, depois sondagem lenta) em vez
  de polling de 500ms para sempre em páginas/frames sem live; recarga de
  settings só quando uma chave do motor realmente muda.
- Deduplicações: resolução de settings unificada em `common.resolveSettings`,
  cards flutuantes (doação/stall) num único construtor, `ensureInstalledAt`
  compartilhado; removidos eventos e UI mortos
  (`_live_catch_up_onPlaybackRateChange`, `_live_catch_up_reset_playback_rate`,
  `#mode-warning`/`minWarning`).
- Radiogroup de valores do PIX navegável por teclado (setas/Home/End), `lang`
  do popup segue o idioma real da interface.
- CI usa `npm ci`; `package.json` declara `engines.node >= 22.2`; versões dos
  manifests normalizadas para `1.1.0`.

## [1.1.0] - 2026-06-30

### Adicionado

- Doação opcional adaptada ao idioma: PIX (com QR Code local) para pt-BR e
  Buy Me a Coffee para en.
- Aviso de travamento da transmissão, sugerindo trocar de modo quando a conexão
  não sustenta o alvo de buffer.

### Alterado

- Conformidade de licença: atribuição explícita ao projeto base
  [live-catch-up](https://github.com/yudai-tiny-developer/live-catch-up)
  (MIT/Apache-2.0) em `THIRD-PARTY-NOTICES.md`.

## [1.0] - 2026-06-23

### Adicionado

- Lançamento inicial na Chrome Web Store (Manifest V3).
- Motor de catch-up que reduz a latência das lives acelerando temporariamente a
  reprodução e voltando a `1.0x` ao alcançar o ao vivo.
- Popup de configurações com modos de um toque e indicadores opcionais no player
  (velocidade, latência ao vivo e saúde do buffer).
- Localização em inglês e português (BR).
- Doação opcional via PIX com QR Code gerado localmente.
