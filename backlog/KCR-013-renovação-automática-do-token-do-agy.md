# [KCR-013] Renovação automática do token do agy

**Status:** 🔴 Rascunho
**Epic:** Epic 2 — Credenciais e login
**Complexidade:** M

---

## Contexto / Problema

Se o spike [KCR-012](KCR-012-spike-renovação-não-interativa-do-agy.md) achar um comando não interativo que renova o token, o console roda esse comando periodicamente. Assim o Antigravity não vence enquanto o login de base (sessão do Google) continuar válido.

Se o spike concluir que não é possível (opção **B**), esta história fica ❌ Cancelada, e a visibilidade e os alertas ([KCR-020](KCR-020-painel-de-status-dos-logins.md), [KCR-021](KCR-021-alertas-de-expiração-e-falha.md)) passam a ser o mecanismo principal.

---

## Escopo

**Rotina (`deploy/console/refresh-agy.sh`), rodando em loop no container `console`:**
```bash
while true; do
  remaining=$(segundos até o expiry lido do arquivo do agy)
  if [ "$remaining" -lt 1200 ]; then            # menos de 20 min
    timeout 60 agy <comando-do-spike> </dev/null >/tmp/agy-refresh.log 2>&1 \
      && result=ok || result=fail
    grava /data/.ccr-console/agy-refresh.json { at, result, expiry_after }
  fi
  sleep 300
done
```
- O estado vai para `/data/.ccr-console/agy-refresh.json`, que o painel lê.
- Nunca registra tokens: a saída do `agy` fica em `/tmp`, e só o resultado vai para o JSON.
- Faz backoff depois de falhas seguidas, para não martelar a API.

**Não entra:**
- O login inicial ou refeito à mão ([KCR-011](KCR-011-console-web-para-login-do-agy.md)).

---

## Histórias de Usuário

- Como usuário, quero que o Antigravity não vença sozinho a cada hora, para que o classificador do auto mode não trave minhas sessões.

---

## Critérios de Aceite

- [ ] Por 24h seguidas, o Antigravity não aparece como "locked" no CCR.
- [ ] O `agy-refresh.json` mostra renovações com `result: ok`, e o `expiry` avança a cada ciclo.
- [ ] Uma falha de renovação (ex.: sessão do Google revogada) fica registrada e dispara o alerta da KCR-021.
- [ ] Nenhum token aparece em `kubectl logs` do container `console`.

---

## Dependências

- KCR-012 (define o comando e se a história é viável)
- KCR-INFRA-002 (a rotina roda na imagem do console)

---

## Perguntas em Aberto

- Qual o intervalo e a margem ideais? Dependem da duração real do token e do custo do comando (KCR-012).
