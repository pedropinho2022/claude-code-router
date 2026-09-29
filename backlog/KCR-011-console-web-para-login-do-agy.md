# [KCR-011] Console web para login do agy

**Status:** 🔴 Rascunho
**Epic:** Epic 2 — Credenciais e login
**Complexidade:** M

---

## Contexto / Problema

O login do Antigravity só acontece pelo `agy`: é um OAuth do Google que abre uma URL e espera o retorno. Ele grava `HOME/.gemini/antigravity-cli/antigravity-oauth-token`. O token dura cerca de 1h. Quando vence, o CCR responde com o provider "locked" ("Antigravity CLI login was detected, but the access token expired. Run agy to refresh it, then rescan.") e o card de quota falha.

No WSL isso se resolvia abrindo o `agy`. No pod, é preciso um terminal acessível sem SSH no nó. Esse terminal é o `ttyd` do container `console` ([KCR-INFRA-002](KCR-INFRA-002-imagem-do-console-de-credenciais.md)).

---

## Decisões confirmadas

| Decisão | Escolha |
|---------|---------|
| Acesso ao terminal | Só `kubectl port-forward`. Sem Service exposto e sem Ingress. |
| Motivo | O terminal dá shell com acesso a **todos** os tokens em `/data` |

---

## Escopo

**Fluxo de uso:**
```bash
kubectl -n ccr port-forward deploy/ccr 7681:7681
# abrir http://127.0.0.1:7681 → terminal bash no container console
agy          # fazer o login / renovar
```

**Wireframe:**
```
┌─ http://127.0.0.1:7681 ─────────────────────────────────────┐
│ console@ccr:/data$ agy                                      │
│ Open this URL to sign in: https://accounts.google.com/...   │
│ Waiting for authorization...                                 │
│ ✓ Signed in as pepeupepeo@gmail.com                         │
│ console@ccr:/data$ █                                        │
└─────────────────────────────────────────────────────────────┘
```

**Pontos de atenção do OAuth:** se o `agy` usa callback em `localhost:<porta>`, o navegador (na sua máquina) não alcança o pod. Opções, em ordem de preferência:
1. Fluxo de "colar o código", se o `agy` oferecer.
2. Um `port-forward` extra para a porta de callback durante o login.
3. Fazer o login no WSL e copiar o arquivo para o PVC (`kubectl cp`). Serve como contingência.

**Não entra:**
- Renovação automática ([KCR-013](KCR-013-renovação-automática-do-token-do-agy.md)).
- Login do Claude ([KCR-010](KCR-010-token-de-longa-duração-do-claude.md)).

---

## Histórias de Usuário

- Como operador, quero abrir um terminal no pod pelo navegador, para rodar o `agy` e renovar o Antigravity em segundos.
- Como operador, quero que esse terminal não fique exposto na rede, porque ele dá acesso a todos os tokens.

---

## Critérios de Aceite

- [ ] Com `kubectl port-forward`, o terminal abre em `http://127.0.0.1:7681`.
- [ ] Rodar o `agy` no terminal atualiza `/data/.gemini/antigravity-cli/antigravity-oauth-token` com um novo `expiry`.
- [ ] Depois do login, **Scan again** na UI mostra o Antigravity disponível, sem reiniciar o pod.
- [ ] Nenhum Service ou Ingress aponta para a porta 7681 (confirmado com `kubectl get svc,ingress -n ccr`).
- [ ] O runbook "Antigravity venceu" está no `deploy/k8s/README.md`.

---

## Dependências

- KCR-INFRA-002 (imagem com `agy` e `ttyd`)
- KCR-002 (container `console` no pod)

---

## Perguntas em Aberto

- Como o `agy` conclui o OAuth: callback em localhost, código para colar ou device code? Isso define o fluxo acima (depende do spike [KCR-012](KCR-012-spike-renovação-não-interativa-do-agy.md)).
