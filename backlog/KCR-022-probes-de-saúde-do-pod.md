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
startupProbe:   { httpGet: { path: /,       port: 8080 }, periodSeconds: 5,  failureThreshold: 24 }
livenessProbe:  { httpGet: { path: /,       port: 8080 }, periodSeconds: 30, failureThreshold: 4 }
readinessProbe: { httpGet: { path: /health, port: 8080 }, periodSeconds: 15, failureThreshold: 3 }
# container console
livenessProbe:  { httpGet: { path: /healthz, port: 8090 }, periodSeconds: 30 }
```
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
- [ ] Travar o nginx faz o kubelet reiniciar o container em até cerca de 2 min.

---

## Dependências

- KCR-002

---

## Perguntas em Aberto

- O `/health` passa a dar 200 assim que existe um provider, ou depende de algum passo extra na UI (ex.: "start the gateway" em **Server**, citado no `docker/README.md`)?
