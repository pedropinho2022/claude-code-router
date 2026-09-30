# [KCR-020] Painel de status dos logins

**Status:** 🔴 Rascunho
**Epic:** Epic 3 — Visibilidade e alertas
**Complexidade:** M

---

## Contexto / Problema

Hoje, para saber se um login venceu, é preciso esbarrar num erro (401, "locked", classificador "temporarily unavailable"). O pedido é **ver com antecedência quando refazer o login e quanto tempo falta**.

Os dois logins se comportam de forma diferente:

| Login | Fonte da validade | Ritmo |
|-------|-------------------|-------|
| Claude (setup-token) | `CLAUDE_TOKEN_CREATED_AT` + 365 dias (Secret `ccr-claude`) | anual |
| Antigravity (`agy`) | `token.expiry` em `/data/.gemini/antigravity-cli/antigravity-oauth-token` | ~1h |

A quota do Antigravity (5h/semanal) já vem da nuvem via `retrieveUserQuotaSummary` (commit `350a1c0`, `fetchAntigravityCloudQuotaSummary`). O painel pode fazer a mesma chamada com o token do `agy` e o project do `loadCodeAssist`, enviando os headers de identidade do Antigravity.

---

## Decisões confirmadas

| Decisão | Escolha |
|---------|---------|
| Onde roda | Container `console`, porta `8090`, só leitura |
| Exposição | Ingress interno com allowlist (KCR-003). **Nunca** mostra tokens. |

---

## Escopo

**Endpoints do painel:**
- `GET /`: página HTML (atualiza a cada 60s).
- `GET /status.json`: o mesmo conteúdo, para alertas e integrações:
```json
{
  "claude":      { "state": "ok|warn|expired", "expires_at": "2027-09-29T00:00:00Z", "days_left": 364,
                   "quota": { "5h": 0.0, "7d": 0.32, "7d_reset": "2026-10-02T17:00:00Z" } },
  "antigravity": { "state": "ok|warn|expired|missing", "expires_at": "...", "minutes_left": 42,
                   "last_refresh": { "at": "...", "result": "ok|fail" },
                   "quota": { "gemini_5h": 0.98, "gemini_weekly": 0.99, "3p_5h": 0.0, "3p_weekly": 0.4 } },
  "gateway":     { "state": "ok|down", "checked_at": "..." }
}
```
- `GET /healthz`: 200 enquanto o próprio servidor do painel estiver vivo.

**Quota do Claude:** disponível mesmo com o setup-token (ver [KCR-010](KCR-010-token-de-longa-duração-do-claude.md)). O painel lê os meters `claude_five_hour_quota` e `claude_seven_day_quota` do card de Account Balance do CCR, ou faz o mesmo cálculo a partir dos cabeçalhos `anthropic-ratelimit-unified-*`.

**Regras de estado:**
- Claude: `warn` com ≤ 30 dias, `expired` com ≤ 0.
- Antigravity: `warn` com ≤ 10 min **e** a última renovação com falha (ou sem renovação automática); `expired` com ≤ 0.
- Gateway: `GET http://127.0.0.1:8080/health` a partir do mesmo pod.

**Wireframe:**
```
┌──────────────── CCR · Status dos logins ────────────────┐
│ ● Claude Max (setup-token)     OK      vence em 364 dias │
│   criado em 2026-09-29 · próximo aviso em 2027-08-30     │
│                                                          │
│ ● Antigravity (agy)            OK      vence em 42 min   │
│   última renovação 12:40 ✓   ·  quota Gemini 5h 98%      │
│   Claude/GPT 5h 0% (volta 00:31) · semanal 40%           │
│   ↳ se vencer: kubectl -n ccr port-forward deploy/ccr    │
│     7681:7681  → http://127.0.0.1:7681  → agy            │
│                                                          │
│ ● Gateway CCR                  OK      /health 200       │
└──────────────── atualizado há 12s ───────────────────────┘
```

**Não entra:**
- Envio de alertas ([KCR-021](KCR-021-alertas-de-expiração-e-falha.md)).
- Qualquer ação de escrita (login, renovação) pelo painel.

---

## Histórias de Usuário

- Como usuário, quero ver quanto tempo falta para cada login vencer, para renovar antes de travar o trabalho.
- Como usuário, quero ver a quota do Antigravity junto, para saber se uma falha é login vencido ou quota esgotada.

---

## Critérios de Aceite

- [ ] `/status.json` reflete o `expiry` real do arquivo do `agy` (diferença menor que 1 min).
- [ ] Com o token do `agy` vencido, o Antigravity aparece como `expired` e a página mostra o passo a passo de renovação.
- [ ] O vencimento do Claude aparece corretamente a partir do `CLAUDE_TOKEN_CREATED_AT`.
- [ ] Nenhuma resposta do painel contém `access_token`, `sk-ant-` ou o token da UI (conferido com `grep` na resposta).
- [ ] Se a chamada de quota falhar, o painel mostra "quota indisponível", sem derrubar o resto da página.

---

## Dependências

- KCR-INFRA-002 (roda no console)
- KCR-010 (`CLAUDE_TOKEN_CREATED_AT`)
- KCR-013 (estado da renovação, se existir)

---

## Perguntas em Aberto

- Dá pra validar o token do Claude de verdade, sem gastar quota (ex.: `GET https://api.anthropic.com/v1/models` com Bearer + beta OAuth)? Se der, o painel detecta revogação antes do vencimento. Se não, ele confia na data.
