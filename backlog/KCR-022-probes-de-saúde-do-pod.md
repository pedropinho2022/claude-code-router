# [KCR-022] Probes de saúde do pod

**Status:** 🔴 Rascunho
**Epic:** Epic 3 — Visibilidade e alertas
**Complexidade:** P

---

## Contexto / Problema

A imagem oficial tem um `HEALTHCHECK` Docker que faz `GET /` no nginx, mas o Kubernetes ignora `HEALTHCHECK`. O `docker/README.md` avisa que o `/health` é a saúde do **gateway** e pode retornar 502 até existir provider e modelo configurados. No WSL, o CCR já travou em estado `D` (acesso a disco preso). Num pod, um processo travado precisa ser reiniciado sozinho.

---

## Escopo

```yaml
# container ccr
startupProbe:   { httpGet: { path: /,       port: 8080 }, periodSeconds: 5,  timeoutSeconds: 5, failureThreshold: 36 }
livenessProbe:  { httpGet: { path: /,       port: 8080 }, periodSeconds: 30, timeoutSeconds: 10, failureThreshold: 6 }
readinessProbe: { httpGet: { path: /health, port: 8080 }, periodSeconds: 15, timeoutSeconds: 5, failureThreshold: 3 }
# container console
livenessProbe:  { httpGet: { path: /healthz, port: 8090 }, periodSeconds: 30, timeoutSeconds: 5 }
```
- **`timeoutSeconds` explícito é obrigatório.** O padrão do Kubernetes é 1 s. Na primeira implantação, uma probe de liveness em `/` estourou por "context deadline exceeded" numa pausa curta do nó e o kubelet reiniciou um pod saudável; na subida seguinte, o gateway interno não respondeu em 15 s (`did not become healthy`) e o pod ficou `2/2 Ready` com o gateway fora do ar, porque a readiness também usava `/`.
- A readiness em `/health` só faz sentido se o gateway estiver habilitado; ela tira o pod do Service enquanto o gateway não responde.
- Em nó lento, definir `CCR_GATEWAY_STARTUP_TIMEOUT_MS` (padrão 15000) no container `ccr`.
- **Liveness** usa `/` (nginx + estáticos), para não reiniciar o pod só porque o gateway está sem provider.
- **Readiness** usa `/health`, para o Service só mandar tráfego quando o gateway está de pé.

**Não entra:**
- Alertas ([KCR-021](KCR-021-alertas-de-expiração-e-falha.md), que já cobre "gateway fora").

---

## Histórias de Usuário

- Como operador, quero que o pod se recupere sozinho se o CCR travar, sem eu precisar agir.

---

## Critérios de Aceite

- [ ] Um pod novo, ainda sem providers, não entra em loop de reinício.
- [ ] Matar o processo do gateway dentro do container tira o pod do Service (readiness) até ele voltar.
- [ ] Travar o nginx faz o kubelet reiniciar o container em até cerca de 3 min.
- [ ] Uma pausa de poucos segundos de CPU no nó (ex.: `stress` no worker) **não** reinicia o pod.
- [ ] Com o gateway interno fora do ar, o pod fica `0/2 Ready` (não `2/2`).

---

## Dependências

- KCR-002

---

## Perguntas em Aberto

- O `/health` passa a dar 200 assim que existe um provider, ou depende de algum passo extra na UI (ex.: "start the gateway" em **Server**, citado no `docker/README.md`)?
