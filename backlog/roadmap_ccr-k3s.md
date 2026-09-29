# Backlog — CCR no k3s: gateway de modelos como serviço interno

**"Um CCR só, sempre de pé, com os logins visíveis e fáceis de renovar."**

Leva o Claude Code Router deste fork (com Antigravity) do serviço systemd no WSL para um pod no cluster k3s interno. A base é a imagem Docker oficial do repositório (`Dockerfile`, `docker/`), que já serve UI, RPC e gateway por uma porta só. Três coisas vêm em cima dela: o token de longa duração do Claude injetado por Secret, um console web para o login do `agy` (Antigravity CLI) e um painel que mostra quando cada login vence.

> **Reuso:** não há backlog anterior no projeto. As histórias reaproveitam a imagem Docker oficial (`Dockerfile`, `docker/entrypoint.sh`, `docker/README.md`) e o código atual do CCR, citados em cada arquivo.

---

## Status dos itens

| Status | Descrição |
|--------|-----------|
| 🔴 Rascunho | Criado, ainda não discutido |
| 🟡 Em Discussão | Em refinamento com o time |
| 🟢 Refinado | Critérios de aceite definidos, pronto para estimativa |
| ✅ Pronto para Dev | Estimado, sem perguntas em aberto |
| 🚀 Em Desenvolvimento | Sprint atual |
| ✔️ Concluído | Entregue em produção |

---

## Infraestrutura

| ID | Título | Complexidade | Status |
|----|--------|-------------|--------|
| [KCR-INFRA-001](KCR-INFRA-001-imagem-do-ccr-no-registry-interno.md) | Imagem do CCR no registry interno | M | 🔴 Rascunho |
| [KCR-INFRA-002](KCR-INFRA-002-imagem-do-console-de-credenciais.md) | Imagem do console de credenciais | M | 🔴 Rascunho |

---

## Epic 1 — Implantação do CCR no cluster

| ID | Título | Complexidade | Status |
|----|--------|-------------|--------|
| [KCR-001](KCR-001-namespace-volume-e-secrets.md) | Namespace, volume e Secrets | P | 🔴 Rascunho |
| [KCR-002](KCR-002-deployment-do-ccr-com-credenciais-do-claude.md) | Deployment do CCR com credenciais do Claude | M | 🔴 Rascunho |
| [KCR-003](KCR-003-exposição-interna-e-proteção-da-interface.md) | Exposição interna e proteção da interface | M | 🔴 Rascunho |
| [KCR-004](KCR-004-migração-do-wsl-e-cutover-dos-clientes.md) | Migração do WSL e cutover dos clientes | M | 🔴 Rascunho |

---

## Epic 2 — Credenciais e login

| ID | Título | Complexidade | Status |
|----|--------|-------------|--------|
| [KCR-010](KCR-010-token-de-longa-duração-do-claude.md) | Token de longa duração do Claude | P | 🔴 Rascunho |
| [KCR-011](KCR-011-console-web-para-login-do-agy.md) | Console web para login do agy | M | 🔴 Rascunho |
| [KCR-012](KCR-012-spike-renovação-não-interativa-do-agy.md) | Spike: renovação não interativa do agy | P | 🔴 Rascunho |
| [KCR-013](KCR-013-renovação-automática-do-token-do-agy.md) | Renovação automática do token do agy | M | 🔴 Rascunho |

---

## Epic 3 — Visibilidade e alertas

| ID | Título | Complexidade | Status |
|----|--------|-------------|--------|
| [KCR-020](KCR-020-painel-de-status-dos-logins.md) | Painel de status dos logins | M | 🔴 Rascunho |
| [KCR-021](KCR-021-alertas-de-expiração-e-falha.md) | Alertas de expiração e falha | P | 🔴 Rascunho |
| [KCR-022](KCR-022-probes-de-saúde-do-pod.md) | Probes de saúde do pod | P | 🔴 Rascunho |

---

## Epic 4 — Operação

| ID | Título | Complexidade | Status |
|----|--------|-------------|--------|
| [KCR-030](KCR-030-backup-dos-dados-do-ccr.md) | Backup dos dados do CCR | P | 🔴 Rascunho |
| [KCR-031](KCR-031-runbook-de-atualização-e-rollback.md) | Runbook de atualização e rollback | P | 🔴 Rascunho |

---

## Arquitetura alvo

```
                  ┌──────────────────────── Pod ccr (1 réplica) ─────────────────────────┐
 Claude Code ───► │ ccr  (imagem oficial)            :8080  UI + /api/ccr/rpc + /v1/*    │
 Win / WSL        │   nginx → server.js (3459) + gateway (3456)                           │
 (Ingress interno)│        │                                                              │
                  │        ▼  PVC /data  (HOME dos dois containers)                       │
                  │   .claude/.credentials.json      ← initContainer, a partir do Secret  │
                  │   .gemini/antigravity-cli/antigravity-oauth-token  ← agy (console)    │
                  │   .claude-code-router/  config.sqlite, api-keys, regras, logs         │
                  │        ▲                                                              │
 você (admin) ──► │ console  :7681 ttyd (terminal: agy)      → só kubectl port-forward    │
                  │          :8090 painel de status (só leitura) → Ingress interno        │
                  └───────────────────────────────────────────────────────────────────────┘
```

---

## Road Map (Fases)

| Fase | Itens |
|------|-------|
| **Fase 0 — Fundação** | KCR-INFRA-001, KCR-001, KCR-010, KCR-012 |
| **Fase 1 — CCR no ar** | KCR-002, KCR-003, KCR-022 |
| **Fase 2 — Logins operáveis** | KCR-INFRA-002, KCR-011, KCR-013 |
| **Fase 3 — Cutover** | KCR-004 |
| **Fase 4 — Visibilidade e operação** | KCR-020, KCR-021, KCR-030, KCR-031 |

---

## Legendas de Complexidade

| Símbolo | Estimativa |
|---------|-----------|
| P | Pequeno — menos de 2 dias |
| M | Médio — 2-5 dias |
| G | Grande — 1-2 semanas |
| GG | Muito Grande — mais de 2 semanas |
