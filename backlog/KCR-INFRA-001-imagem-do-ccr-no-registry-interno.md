# [KCR-INFRA-001] Imagem do CCR no registry interno

**Status:** 🔴 Rascunho
**Epic:** Infraestrutura
**Complexidade:** M

---

## Contexto / Problema

Hoje o CCR roda do código-fonte, pelo `ccr serve` num serviço systemd no WSL. Para rodar no cluster, é preciso uma imagem publicada no **registry interno que já existe**.

O repositório já tem tudo pronto para isso:
- `Dockerfile` multi-stage (`build` → `production-deps` → `runtime`, com base `node:22-bookworm-slim`).
- `docker/entrypoint.sh`: define `HOME=/data`, gera a config inicial, sincroniza `routerEndpoint`/gateway e escreve o nginx.
- `docker/pm2.config.cjs`: roda `packages/core/dist/main/server.js` e o nginx sob o `pm2-runtime`.
- `npm run docker:build` → `build/docker-image.mjs`. Ele tenta empacotar um `../../next-ai/gateway` local; se não encontrar, usa o `@the-next-ai/ai-gateway` do `package-lock` (`build/docker-local-gateway.mjs`). Então um `docker build .` puro funciona.

A imagem precisa sair **deste branch** (`claude/funny-johnson-1t6cfy`), porque é nele que estão o Antigravity e as correções:
- `9d379e4`: hooks de OAuth local no gateway 1.0.21;
- `db9b9a7`: roteamento de modelo dos subagentes;
- `350a1c0`: quota do Antigravity lida da nuvem.

---

## Decisões confirmadas

| Decisão | Escolha |
|---------|---------|
| Registry | Registry interno já existente |
| Base da imagem | `Dockerfile` oficial do repositório, sem fork do Dockerfile |
| Origem do código | Branch `claude/funny-johnson-1t6cfy` (ou sucessor) |

---

## Escopo

**Build e publicação:**
```bash
docker build -t <registry>/ccr/claude-code-router:<git-sha> .
docker push <registry>/ccr/claude-code-router:<git-sha>
```
- Tag imutável = SHA curto do commit, e mais a tag móvel `stable`, que aponta para a versão em produção.
- Se o cluster tiver nós arm64 (Orange Pi): gerar com `docker buildx build --platform linux/amd64,linux/arm64`. O `better-sqlite3` tem binário nativo, então o build precisa acontecer para cada arquitetura (sem QEMU só para copiar).
- Automação opcional: reaproveitar o pipeline por `post-receive` que você já usa no Orange Pi para outros projetos, disparando o build a cada push no branch.

**Não entra:**
- Os CLIs `claude`/`agy` dentro da imagem do CCR (ficam na [KCR-INFRA-002](KCR-INFRA-002-imagem-do-console-de-credenciais.md)).
- Os manifests do Kubernetes ([KCR-002](KCR-002-deployment-do-ccr-com-credenciais-do-claude.md)).
- O `.exe` do Windows, cujo workflow `build-windows.yml` continua como está.

---

## Histórias de Usuário

- Como operador, quero uma imagem versionada do CCR no registry interno, para que o cluster rode exatamente o código deste branch.
- Como operador, quero tags imutáveis por commit, para que eu consiga voltar para uma versão anterior sem rebuild.

---

## Critérios de Aceite

- [ ] `docker build .` na raiz do branch termina sem erro, sem precisar do `next-ai/gateway` local.
- [ ] A imagem é publicada no registry interno com a tag `<sha>` e com `stable`.
- [ ] A imagem sobe localmente com `docker run -p 3458:8080 -v ccr-test:/data <imagem>`, e a UI abre em `http://127.0.0.1:3458`.
- [ ] O provider Antigravity aparece no scan de providers locais quando `/data/.gemini/antigravity-cli/antigravity-oauth-token` existe, o que prova que o código do fork está na imagem.
- [ ] Se houver nós arm64: o manifest da imagem lista `linux/amd64` e `linux/arm64`.

---

## Dependências

**Nenhuma**

---

## Perguntas em Aberto

- Qual o endereço do registry e como o cluster autentica nele: é anônimo na rede interna ou precisa de `imagePullSecret`?
- O build vai ser manual ou pelo pipeline `post-receive` do Orange Pi?
- Qual a arquitetura dos nós (`kubectl get nodes -L kubernetes.io/arch`)? Isso define se precisa de multi-arch.
