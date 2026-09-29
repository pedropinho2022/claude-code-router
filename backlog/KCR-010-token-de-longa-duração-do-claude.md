# [KCR-010] Token de longa duração do Claude

**Status:** 🔴 Rascunho
**Epic:** Epic 2 — Credenciais e login
**Complexidade:** P

---

## Contexto / Problema

O login interativo do Claude (`claude /login`) gera um access token de poucas horas. Quem o renova é o CLI do Claude Code. O CCR só lê o arquivo (`readClaudeCodeOauth`) e **não renova** ([KCR-002](KCR-002-deployment-do-ccr-com-credenciais-do-claude.md)). Num pod sem o CLI, esse token venceria em horas.

O `claude setup-token` resolve isso: ele gera um token OAuth `sk-ant-oat01-…` válido por **1 ano**, ligado à assinatura Max. É o mesmo tipo de credencial que o Claude Code usa com `CLAUDE_CODE_OAUTH_TOKEN`. O CCR envia esse token como `Authorization: Bearer` com o header beta de OAuth (`authenticateClaudeCode` adiciona `claudeCodeOauthRequiredBeta`), que é o mesmo caminho do login normal.

---

## Decisões confirmadas

| Decisão | Escolha |
|---------|---------|
| Credencial do Claude no cluster | Token do `claude setup-token`, guardado no Secret `ccr-claude` |
| Mudança no CCR para ler variável de ambiente | **Não.** Injeção pelo arquivo, via initContainer (KCR-002) |
| Onde gerar o token | Qualquer máquina com Claude Code (ex.: o WSL), fora do cluster |

---

## Escopo

**Geração e registro:**
```bash
claude setup-token            # login da conta Max no navegador → imprime sk-ant-oat01-...
kubectl -n ccr create secret generic ccr-claude \
  --from-literal=CLAUDE_CODE_OAUTH_TOKEN='sk-ant-oat01-...' \
  --from-literal=CLAUDE_TOKEN_CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n ccr rollout restart deploy/ccr
```

**Runbook de rotação anual** (em `deploy/k8s/README.md`):
1. Gerar um token novo com `claude setup-token`.
2. Aplicar o Secret com o novo `CLAUDE_TOKEN_CREATED_AT`.
3. Rodar `rollout restart`.
4. Fazer uma requisição de teste.
5. Opcional: revogar o token antigo em claude.ai → Settings (se a interface permitir).

O painel ([KCR-020](KCR-020-painel-de-status-dos-logins.md)) calcula o vencimento como `CLAUDE_TOKEN_CREATED_AT + 365 dias`.

**Não entra:**
- CLI do `claude` dentro do cluster.
- Renovação automática: ela não existe para esse tipo de token, e a rotação é manual e anual.

---

## Histórias de Usuário

- Como operador, quero uma credencial do Claude que dure um ano, para que o CCR no pod não pare a cada poucas horas.
- Como operador, quero registrar quando o token foi criado, para ser avisado antes de ele vencer.

---

## Critérios de Aceite

- [ ] Com o token do `setup-token` no Secret, uma requisição `POST /v1/messages` para `Claude Code API/claude-sonnet-5` retorna 200.
- [ ] Uma sessão real do Claude Code (conversa + ferramenta + subagente) funciona inteira pelo pod.
- [ ] Gerar o token **não** derruba o CCR do WSL enquanto ele ainda estiver em uso (conferido antes do cutover da KCR-004).
- [ ] O runbook de rotação está documentado e foi testado uma vez.

---

## Dependências

- KCR-001 (namespace e Secret)

---

## Perguntas em Aberto

- O card de quota do Claude (5h / 7d, em **Account Balance**) funciona com esse token? Ele tem escopo só de inferência, e a consulta de uso pode exigir `user:profile`. Se não funcionar, o painel mostra só o vencimento do token.
- O `claude setup-token` revoga o login interativo existente? Pela natureza do token, a expectativa é que não, mas é preciso confirmar (primeiro critério de aceite acima).
