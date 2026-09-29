# [KCR-001] Namespace, volume e Secrets

**Status:** 🔴 Rascunho
**Epic:** Epic 1 — Implantação do CCR no cluster
**Complexidade:** P

---

## Contexto / Problema

O CCR guarda tudo em `HOME/.claude-code-router` (`config.sqlite`, `app-data/api-keys.sqlite`, `request-logs.sqlite`, `usage.sqlite`, `profiles/`), além dos logins em `HOME/.claude` e `HOME/.gemini`. Na imagem oficial, `HOME=/data` (`docker/entrypoint.sh`). O `docker/README.md` avisa que o diretório de dados **não pode ser compartilhado por dois CCR rodando ao mesmo tempo** (SQLite com WAL).

Os segredos que antes ficavam em arquivos do WSL (`~/.config/ccr/web.env`, `~/.claude/.credentials.json`) passam a ser Secrets do Kubernetes.

---

## Escopo

**Manifests (`deploy/k8s/`):**
```yaml
# 00-namespace.yaml
apiVersion: v1
kind: Namespace
metadata: { name: ccr }
---
# 10-pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: ccr-data, namespace: ccr }
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 5Gi } }
  # storageClassName: local-path   # padrão do k3s; ver Perguntas em Aberto
```

**Secrets (criados via `kubectl`, nunca versionados):**

| Secret | Chaves | Consumido por |
|--------|--------|---------------|
| `ccr-web` | `CCR_WEB_AUTH_TOKEN` | container `ccr` (env) |
| `ccr-claude` | `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_TOKEN_CREATED_AT` | initContainer (KCR-002), painel (KCR-020) |
| `ccr-alerts` | URL/token do canal de alerta | console (KCR-021) |

```bash
kubectl -n ccr create secret generic ccr-web \
  --from-literal=CCR_WEB_AUTH_TOKEN="$(openssl rand -base64 32 | tr -d '/+=')"
```

**Não entra:**
- O conteúdo do token do Claude e como ele é gerado ([KCR-010](KCR-010-token-de-longa-duração-do-claude.md)).
- Backup do PVC ([KCR-030](KCR-030-backup-dos-dados-do-ccr.md)).

---

## Histórias de Usuário

- Como operador, quero os dados do CCR num volume persistente, para que providers, regras e API keys sobrevivam a reinícios e atualizações.
- Como operador, quero os segredos em Secrets do Kubernetes, para que eles não fiquem na imagem nem no Git.

---

## Critérios de Aceite

- [ ] O namespace `ccr` e o PVC `ccr-data` são criados, e o PVC fica `Bound` quando o pod sobe.
- [ ] Os Secrets `ccr-web` e `ccr-claude` existem, e nenhum valor secreto está em arquivo versionado.
- [ ] `deploy/k8s/README.md` documenta os comandos `kubectl create secret` e a ordem de aplicação dos manifests.
- [ ] Apagar e recriar o pod mantém os dados do PVC.

---

## Dependências

**Nenhuma**

---

## Perguntas em Aberto

- Qual StorageClass usar: o `local-path` padrão do k3s (que prende o pod ao nó onde o volume foi criado) ou um storage de rede (NFS/Longhorn)?
- Os Secrets vão ser só via `kubectl`, ou você já usa algum gerenciador (Sealed Secrets, SOPS, External Secrets)?
