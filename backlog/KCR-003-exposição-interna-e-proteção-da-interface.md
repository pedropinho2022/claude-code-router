# [KCR-003] Exposição interna e proteção da interface

**Status:** 🔴 Rascunho
**Epic:** Epic 1 — Implantação do CCR no cluster
**Complexidade:** M

---

## Contexto / Problema

A imagem oficial expõe tudo pela porta `8080` do nginx: a UI, o `/api/ccr/rpc`, o `/health` e as rotas de modelo (`/v1/*`, `/v1beta/*`, `/messages`, `/chat/completions`, `/responses`, `/mcp/*`).

**Risco que o `docker/entrypoint.sh` cria:** o nginx faz `location = / { return 302 /pages/home/index.html?ccr_web_token=<TOKEN>; }`. Ou seja, **qualquer pessoa que chegue em `/` recebe o token de administração no redirect.** Na prática, a UI fica protegida só pela rede. Com o Ingress, é preciso limitar quem chega até ela.

O gateway (`/v1/*`) é outra história: ele é protegido pelas API keys do CCR (página **API Keys**), que já são usadas hoje no `ANTHROPIC_AUTH_TOKEN` dos clientes.

---

## Decisões confirmadas

| Decisão | Escolha |
|---------|---------|
| Terminal (`ttyd`) | **Nunca** tem Ingress. Acesso só por `kubectl port-forward`. |
| Rotas de modelo | Ingress interno, autenticadas pelas API keys do CCR |
| UI de administração | Ingress interno com camada extra (allowlist de IP ou basic auth) |

---

## Escopo

**Service (`deploy/k8s/30-service.yaml`):**
```yaml
apiVersion: v1
kind: Service
metadata: { name: ccr, namespace: ccr }
spec:
  selector: { app: ccr }
  ports:
    - { name: http,   port: 80,   targetPort: 8080 }
    - { name: status, port: 8090, targetPort: 8090 }   # painel, só leitura
  # sem porta 7681 (ttyd)
```

**Ingress (Traefik, padrão do k3s):**
- `ccr.<dominio>` → `ccr:80`.
- Middleware `ipAllowList` restrito à rede interna/VPN, aplicado a tudo.
- Opcional: middleware `basicAuth` extra só para `/` e `/pages/*` (a UI), deixando `/v1/*` apenas com a API key.
- `ccr-status.<dominio>` → `ccr:8090` (painel da [KCR-020](KCR-020-painel-de-status-dos-logins.md)), com a mesma allowlist.

**Streaming:** o nginx interno já usa `proxy_buffering off` e `proxy_read_timeout 3600s`. No Traefik, é preciso conferir que respostas SSE longas (minutos) não são cortadas, nem acumuladas em buffer.

**Não entra:**
- TLS público ou exposição para a internet.
- Acesso ao terminal ([KCR-011](KCR-011-console-web-para-login-do-agy.md)).

---

## Histórias de Usuário

- Como usuário do Claude Code no Windows e no WSL, quero um endereço fixo do CCR na rede interna, para apontar o `ANTHROPIC_BASE_URL` pra ele.
- Como operador, quero que só a minha rede alcance a UI, porque quem chega em `/` recebe o token de administração.

---

## Critérios de Aceite

- [ ] `curl https://ccr.<dominio>/v1/models` sem API key retorna 401; com API key, retorna a lista de modelos.
- [ ] Uma resposta com streaming de mais de 5 minutos chega inteira ao Claude Code, sem corte nem atraso de buffer.
- [ ] Fora da allowlist, `/` retorna 403, e o token não aparece em nenhum redirect.
- [ ] Não existe Service nem Ingress apontando para a porta 7681.
- [ ] O `/health` responde pelo Ingress (usado em [KCR-022](KCR-022-probes-de-saúde-do-pod.md)).

---

## Dependências

- KCR-002 (pod rodando)

---

## Perguntas em Aberto

- O Ingress do cluster é o Traefik padrão do k3s? Qual o domínio interno, e existe DNS interno (ou vai ser `/etc/hosts`)?
- A rede interna tem TLS (CA interna)? Se não tiver, o Claude Code vai usar `http://`, o que é aceitável só em rede fechada.
- Basta a allowlist de IP, ou vale colocar basic auth na UI também?
