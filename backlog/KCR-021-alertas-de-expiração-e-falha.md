# [KCR-021] Alertas de expiração e falha

**Status:** 🔴 Rascunho
**Epic:** Epic 3 — Visibilidade e alertas
**Complexidade:** P

---

## Contexto / Problema

O painel ([KCR-020](KCR-020-painel-de-status-dos-logins.md)) só ajuda se alguém olhar para ele. Para o Antigravity (vence a cada hora) e para a rotação anual do Claude (fácil de esquecer), é preciso um **aviso ativo**.

---

## Escopo

**Disparo:** o próprio console avalia o `/status.json` a cada 5 min e envia notificação na **mudança de estado** (ok→warn, warn→expired, expired→ok), não a cada ciclo.

| Evento | Quando | Mensagem |
|--------|--------|----------|
| Claude vencendo | 30 dias e 7 dias antes | "Token do Claude vence em N dias — rodar `claude setup-token` e atualizar o Secret `ccr-claude`" |
| Antigravity vencendo | `warn` (≤ 10 min, sem renovação ok) | "Antigravity vence em N min — abrir o console e rodar `agy`" |
| Renovação do `agy` falhou | 2 falhas seguidas | "Renovação automática do agy falhou: <resultado>" |
| Gateway fora | `/health` falhou 3x seguidas | "Gateway do CCR fora do ar" |
| Recuperação | Volta a `ok` | "✓ <item> normalizado" |

**Canal:** um webhook genérico configurado no Secret `ccr-alerts` (ex.: ntfy, Telegram ou Discord). Uma função `notify(title, body)` isola o canal.

**Não entra:**
- Integração com Prometheus/Alertmanager (possível evolução: expor `/metrics` no painel).

---

## Histórias de Usuário

- Como usuário, quero ser avisado no celular antes de o Antigravity ou o Claude vencer, para não descobrir no meio de uma sessão.

---

## Critérios de Aceite

- [ ] Forçar o vencimento do `agy` (editar o `expiry` num ambiente de teste) gera **um** alerta, sem repetições a cada ciclo.
- [ ] Voltar ao normal gera o alerta de recuperação.
- [ ] Os avisos de 30 e 7 dias do Claude disparam uma vez cada (testado com um `CLAUDE_TOKEN_CREATED_AT` antigo).
- [ ] As mensagens não contêm tokens.

---

## Dependências

- KCR-020 (fonte de estado)
- KCR-001 (Secret `ccr-alerts`)

---

## Perguntas em Aberto

- Qual canal de notificação você já usa: ntfy, Telegram, Discord ou e-mail?
