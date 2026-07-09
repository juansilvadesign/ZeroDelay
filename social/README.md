# Social — posts co-criados pela comunidade

Materialização da [issue #27](https://github.com/joaogfc/ZeroDelay/issues/27):
o ZeroDelay melhora quase todo dia, mas as novidades ficavam escondidas no
CHANGELOG. Esta pasta é o canal entre o repositório e as redes sociais.

## Como funciona

1. **A cada release**, o workflow [`social-draft.yml`](../.github/workflows/social-draft.yml)
   lê a seção da versão no `CHANGELOG.md` e abre um PR com um rascunho de post
   em [`drafts/`](drafts/) — escrito por IA quando o segredo `ANTHROPIC_API_KEY`
   está configurado (baseado SOMENTE no changelog), ou montado dos bullets do
   changelog quando não está.
2. **Um humano revisa** o rascunho no PR: ajusta o tom, corta exagero, confere
   que nada foi inventado. Nada é publicado sem essa revisão — o workflow não
   tem acesso a nenhuma rede social, de propósito.
3. **Publicação é manual** nos perfis oficiais, por quem tem acesso.

## Co-criação

Qualquer pessoa pode propor posts:

- Abra uma issue com o label **`social/content`** com a ideia ou o texto; ou
- Mande um PR direto com um arquivo em `drafts/` (use o frontmatter dos
  rascunhos gerados como modelo).

Ideias aprovadas viram publicação **com crédito ao autor**, no espírito do
[`CONTRIBUTORS.md`](../CONTRIBUTORS.md).

## Regras editoriais

- Tom de quem assiste live: direto, leve, zero jargão corporativo.
- Nunca prometer o que a extensão não faz; o changelog é o limite do factual.
- O "antes e depois" (live atrasada → tempo real) é a história principal.
- Privacidade é argumento, não rodapé: tudo roda local, nada é coletado.
- Melhorias de comunidade citam o autor e o PR (como o CHANGELOG já faz).
