# [KCR-012] Spike: renovação não interativa do agy

**Status:** 🔴 Rascunho
**Epic:** Epic 2 — Credenciais e login
**Complexidade:** P

---

## Contexto / Problema

O token do Antigravity vence em cerca de 1h, e o arquivo do `agy` não guarda refresh token. Hoje ele só renova quando alguém abre o `agy`. Para um pod sem ninguém olhando, é preciso descobrir se existe como renovar sem interação. Sem isso, o Antigravity (incluindo o classificador do auto mode, que foi roteado para o Flash) para a cada hora.

O que já se sabe:
- Formato do arquivo: `{auth_method, id_token, token: {access_token, expiry}}`, com `expiry` em RFC3339 com nanossegundos e fuso.
- O caminho alternativo pelo client OAuth do Gemini CLI (`~/.gemini/oauth_creds.json`, com refresh token) foi **recusado pelo Google** ("client no longer supported").
- **Não vamos** extrair client ID/secret do binário do `agy`.

---

## Escopo

Investigar, no WSL, e registrar num relatório curto:
1. `agy --help` / `agy help <cmd>`: existe modo não interativo (`-p`, `exec`, `auth refresh`, `whoami`, `--version` com checagem de login)?
2. Qual comando, rodado sem TTY (`agy … </dev/null`), atualiza o `expiry` do arquivo? Medir antes e depois.
3. Esse comando consome quota? Um prompt gasta; `whoami`/`status` não deveria.
4. Existe algum arquivo com refresh token em outro lugar (`~/.gemini/antigravity-cli/*`)? Se existir, o `agy` renova sozinho enquanto roda?
5. Qual o fluxo de OAuth do login inicial (callback, código ou device)? Isso alimenta a [KCR-011](KCR-011-console-web-para-login-do-agy.md).
6. Existe binário para `linux/arm64`?

**Não entra:**
- Implementar a rotina ([KCR-013](KCR-013-renovação-automática-do-token-do-agy.md)).

---

## Histórias de Usuário

- Como operador, quero saber se o `agy` renova sem interação, para decidir entre renovação automática e só alerta.

---

## Critérios de Aceite

- [ ] Relatório com respostas para os itens 1–6, com os comandos e as saídas (sem tokens).
- [ ] Recomendação clara: **(A)** renovação automática por comando X a cada N minutos, ou **(B)** só alerta + renovação manual pelo console.
- [ ] As histórias KCR-011 e KCR-013 são atualizadas com o resultado.

---

## Dependências

**Nenhuma**

---

## Perguntas em Aberto

Nenhuma. O spike existe justamente para responder as perguntas acima.
