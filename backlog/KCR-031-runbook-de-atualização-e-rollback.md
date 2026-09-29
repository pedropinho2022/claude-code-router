# [KCR-031] Runbook de atualização e rollback

**Status:** 🔴 Rascunho
**Epic:** Epic 4 — Operação
**Complexidade:** P

---

## Contexto / Problema

Este fork recebe correções com frequência (`9d379e4`, `db9b9a7`, `350a1c0`). No WSL, atualizar era `git pull` + `npm run build:assets` + reiniciar o serviço. No cluster, o fluxo passa a ser imagem → rollout. O `docker/README.md` alerta que as migrações de config rodam sobre os dados persistidos, e que uma versão mais antiga pode não ler um banco migrado.

---

## Escopo

**Atualizar (`deploy/k8s/README.md`):**
1. **Settings → Export data**, ou um backup manual ([KCR-030](KCR-030-backup-dos-dados-do-ccr.md)).
2. Build e push da imagem nova com tag `<sha>` ([KCR-INFRA-001](KCR-INFRA-001-imagem-do-ccr-no-registry-interno.md)).
3. `kubectl -n ccr set image deploy/ccr ccr=<registry>/ccr/claude-code-router:<sha>`
4. `kubectl -n ccr rollout status deploy/ccr`
5. Smoke test: o painel ([KCR-020](KCR-020-painel-de-status-dos-logins.md)) todo verde, uma requisição do Claude Code, uma do classificador (motivo `rule:` no log).

**Rollback:**
- Imagem anterior com `kubectl rollout undo`, **mais** restaurar o backup do passo 1 se a versão nova tiver migrado o banco.

**Não entra:**
- CI/CD automático. Se o pipeline do Orange Pi assumir o build, este runbook passa a ter só os passos 1, 4 e 5.

---

## Histórias de Usuário

- Como operador, quero um passo a passo curto para atualizar e voltar o CCR, para aplicar correções do fork sem medo.

---

## Critérios de Aceite

- [ ] O runbook foi executado uma vez de ponta a ponta numa atualização real.
- [ ] O rollback foi testado uma vez (imagem anterior + restore).
- [ ] O tempo fora do ar numa atualização comum fica abaixo de 1 min (com `Recreate` há uma janela curta, que é aceitável).

---

## Dependências

- KCR-INFRA-001, KCR-002, KCR-030

---

## Perguntas em Aberto

Nenhuma.
