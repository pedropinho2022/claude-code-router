# [KCR-030] Backup dos dados do CCR

**Status:** 🔴 Rascunho
**Epic:** Epic 4 — Operação
**Complexidade:** P

---

## Contexto / Problema

O PVC `ccr-data` concentra a config (providers, regras do Global Routing), as API keys dos clientes, os logs de requisição e os logins em arquivo. O `docker/README.md` recomenda **Settings → Export data** como backup de aplicação e, para cópia de volume, **parar as escritas antes** (SQLite com WAL/SHM). Ele também avisa para não restaurar por cima de um volume em uso.

---

## Escopo

- **Backup de aplicação:** export manual pela UI antes de cada atualização ([KCR-031](KCR-031-runbook-de-atualização-e-rollback.md)), guardado fora do cluster.
- **Backup de volume (CronJob semanal):** um snapshot consistente de `/data/.claude-code-router` usando `sqlite3 .backup` em cada `.sqlite` (assim o pod não precisa parar), empacotado em `tar.zst` e enviado para o destino que você escolher.
- **Exclusões:** `/data/.claude/.credentials.json` e `/data/.gemini/**` ficam **fora** do backup. Eles são recriados pelo Secret e pelo `agy`, e não devem circular em arquivos de backup.
- **Restore documentado:** volume novo e vazio → escalar o deployment para 0 → copiar → escalar para 1.

**Não entra:**
- Backup do histórico além do que já está nos `.sqlite`.

---

## Histórias de Usuário

- Como operador, quero backups periódicos das regras e das API keys, para reconstruir o CCR se o volume se perder.

---

## Critérios de Aceite

- [ ] O CronJob roda e gera um arquivo contendo `config.sqlite` e `app-data/api-keys.sqlite` válidos (`sqlite3 … "pragma integrity_check"` = ok).
- [ ] O backup não contém `.credentials.json` nem `antigravity-oauth-token`.
- [ ] Um restore testado num namespace de teste sobe com as mesmas regras e API keys.

---

## Dependências

- KCR-001, KCR-002

---

## Perguntas em Aberto

- Para onde vão os backups: NAS, bucket S3/MinIO interno, ou outro nó?
- Com `local-path` e `ReadWriteOnce`, o CronJob precisa rodar no mesmo nó do pod. Pode ser mais simples fazer o backup com um `kubectl exec` agendado dentro do próprio container `console`.
