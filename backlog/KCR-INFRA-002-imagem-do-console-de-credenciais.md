# [KCR-INFRA-002] Imagem do console de credenciais

**Status:** 🔴 Rascunho
**Epic:** Infraestrutura
**Complexidade:** M

---

## Contexto / Problema

A imagem oficial do CCR não tem shell interativo nem os CLIs de login. O `docker/README.md` diz que ela "does not include … the npm `ccr` command … desktop Agent/App launching", e o `Dockerfile` ainda remove o `npm`/`npx` no estágio `runtime`. Mas o login do Antigravity precisa do `agy`, que:
- grava `~/.gemini/antigravity-cli/antigravity-oauth-token`, no formato `{auth_method, id_token, token: {access_token, expiry}}`;
- tem token de acesso de cerca de 1h e **não guarda refresh token** nesse arquivo;
- é lido pelo CCR com prioridade sobre `oauth_creds.json` e o keyring (`readAntigravityCliAuth` em `packages/core/src/agents/local-providers/antigravity.ts`).

Por isso é preciso uma segunda imagem, o **console**, que roda ao lado do CCR no mesmo pod e compartilha `/data` como `HOME`. O login do Claude **não** passa por aqui: ele usa o token de longa duração ([KCR-010](KCR-010-token-de-longa-duração-do-claude.md)).

---

## Decisões confirmadas

| Decisão | Escolha |
|---------|---------|
| Login do Claude | Fora do console, via Secret (KCR-010) |
| Terminal web | `ttyd`, só por `kubectl port-forward` |
| Registry | Registry interno já existente |

---

## Escopo

**Conteúdo da imagem (`deploy/console/Dockerfile`):**
```dockerfile
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl bash tini ttyd jq python3 \
    && rm -rf /var/lib/apt/lists/*
# agy: mesmo método de instalação usado no WSL (ver Perguntas em Aberto)
RUN <comando de instalação do agy> && install -m 0755 <agy> /usr/local/bin/agy
COPY status/ /opt/console/status/        # painel da KCR-020
COPY refresh-agy.sh /opt/console/        # rotina da KCR-013
COPY entrypoint.sh /usr/local/bin/console-entrypoint
ENV HOME=/data
USER 1000:1000
ENTRYPOINT ["tini", "--", "console-entrypoint"]
```

**Processos do entrypoint:**
- `ttyd -p 7681 -W bash`: terminal de escrita, ouvindo só no pod, sem Ingress.
- Servidor do painel de status na porta `8090` ([KCR-020](KCR-020-painel-de-status-dos-logins.md)).
- Loop de renovação do `agy` ([KCR-013](KCR-013-renovação-automática-do-token-do-agy.md)), se o spike [KCR-012](KCR-012-spike-renovação-não-interativa-do-agy.md) confirmar que dá.

**Não entra:**
- CLI do `claude` (desnecessário com o token de longa duração).
- Qualquer credencial embutida na imagem; tudo fica no PVC ou em Secret.

---

## Histórias de Usuário

- Como operador, quero uma imagem com o `agy` e um terminal web, para refazer o login do Antigravity sem entrar no nó do cluster.
- Como operador, quero que o console grave os tokens no mesmo `/data` que o CCR lê, para que o login valha na hora, sem copiar arquivos.

---

## Critérios de Aceite

- [ ] A imagem é publicada no registry interno com tag por commit.
- [ ] `agy --version` roda dentro do container.
- [ ] Com `HOME=/data`, o `agy` grava o token em `/data/.gemini/antigravity-cli/antigravity-oauth-token`.
- [ ] O container roda como UID 1000, o mesmo dono dos arquivos do CCR no PVC, sem erro de permissão nos dois sentidos.
- [ ] O `ttyd` não fica exposto por Service com Ingress (conferido em [KCR-011](KCR-011-console-web-para-login-do-agy.md)).

---

## Dependências

- KCR-012 (define se a imagem precisa da rotina de renovação e como ela funciona)

---

## Perguntas em Aberto

- Qual o comando oficial de instalação do `agy` para Linux (o mesmo usado no WSL)? Ele permite fixar a versão?
- Existe binário do `agy` para `linux/arm64`? Se não existir, o pod inteiro precisa de `nodeSelector` para `amd64`.
- Qual UID a imagem oficial do CCR usa ao gravar `/data`? Hoje o `runtime` roda como root. Alinhar os dois containers, ou usar `fsGroup` no pod.
