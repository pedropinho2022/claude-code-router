# [KCR-002] Deployment do CCR com credenciais do Claude

**Status:** 🔴 Rascunho
**Epic:** Epic 1 — Implantação do CCR no cluster
**Complexidade:** M

---

## Contexto / Problema

O provider "Claude Code API" do CCR lê o token de `HOME/.claude/.credentials.json` **a cada requisição**. O fluxo é: `authenticateClaudeCode` em `packages/core/src/gateway/core-runtime/local-agent-auth-provider-hook.ts` chama `readClaudeCodeOauth()`, que por sua vez chama `scanClaudeCodeLogin()` em `packages/core/src/agents/local-providers/claude-code.ts`.

Dois comportamentos confirmados no código:
- Ele aceita `{"claudeAiOauth": {"accessToken": "..."}}` e **não verifica validade**. O `refreshToken` é opcional.
- Ele **não renova** o token. No WSL, quem renovava era o CLI do Claude Code. No pod não há CLI, e é por isso que usamos o token de longa duração ([KCR-010](KCR-010-token-de-longa-duração-do-claude.md)).

A decisão é injetar o token como Secret. Como o CCR lê um arquivo, um **initContainer** escreve esse arquivo a partir do Secret a cada inicialização do pod.

---

## Decisões confirmadas

| Decisão | Escolha |
|---------|---------|
| Como o CCR recebe o token do Claude | Secret → initContainer → `/data/.claude/.credentials.json`. **Sem** mudança no código do CCR. |
| Réplicas | 1, com `strategy: Recreate` (SQLite no PVC, sem dois processos escrevendo) |
| Containers | `ccr` (imagem oficial) + `console` (KCR-INFRA-002) no mesmo pod |

---

## Escopo

**`deploy/k8s/20-deployment.yaml` (trecho):**
```yaml
spec:
  replicas: 1
  strategy: { type: Recreate }
  template:
    spec:
      securityContext: { fsGroup: 1000 }
      initContainers:
        - name: claude-credentials
          image: busybox:1.36
          command: ["/bin/sh", "-c"]
          args:
            - |
              set -eu
              umask 077
              mkdir -p /data/.claude
              printf '{"claudeAiOauth":{"accessToken":"%s"}}\n' "$CLAUDE_CODE_OAUTH_TOKEN" \
                > /data/.claude/.credentials.json.tmp
              mv /data/.claude/.credentials.json.tmp /data/.claude/.credentials.json
          envFrom: [{ secretRef: { name: ccr-claude } }]
          volumeMounts: [{ name: data, mountPath: /data }]
      containers:
        - name: ccr
          image: <registry>/ccr/claude-code-router:<sha>
          ports: [{ name: http, containerPort: 8080 }]
          env:
            - { name: CCR_PUBLIC_BASE_URL, value: "https://ccr.<dominio-interno>" }
          envFrom: [{ secretRef: { name: ccr-web } }]
          volumeMounts: [{ name: data, mountPath: /data }]
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits:   { memory: 1Gi }
        - name: console
          image: <registry>/ccr/console:<sha>
          ports:
            - { name: ttyd,   containerPort: 7681 }
            - { name: status, containerPort: 8090 }
          envFrom: [{ secretRef: { name: ccr-claude } }, { secretRef: { name: ccr-web } }]
          volumeMounts: [{ name: data, mountPath: /data }]
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: ccr-data }
```

**Por que não montar o Secret direto como arquivo:** montar em `/data/.claude` esconderia os outros arquivos que o CCR grava nesse diretório. E com `subPath`, o arquivo não se atualiza quando o Secret muda. O initContainer é explícito e previsível. Para rotacionar: atualizar o Secret e rodar `kubectl rollout restart`.

**Primeira subida:** o provider "Claude Code API" precisa existir na config. Ele chega pela migração ([KCR-004](KCR-004-migração-do-wsl-e-cutover-dos-clientes.md)) ou por **Providers → Scan again → Import** na UI.

**Não entra:**
- Probes ([KCR-022](KCR-022-probes-de-saúde-do-pod.md)).
- Service e Ingress ([KCR-003](KCR-003-exposição-interna-e-proteção-da-interface.md)).

---

## Histórias de Usuário

- Como operador, quero que o pod monte a credencial do Claude a partir de um Secret, para trocar o token sem abrir terminal no pod.
- Como usuário do Claude Code, quero que o CCR no cluster use minha assinatura Max, como no WSL.

---

## Critérios de Aceite

- [ ] O pod sobe com os dois containers `Running`, e o initContainer termina com código 0.
- [ ] `/data/.claude/.credentials.json` existe com permissão `600`, e o token não aparece nos logs do initContainer.
- [ ] O scan de providers locais mostra "Claude Code API" como disponível.
- [ ] Uma requisição `POST /v1/messages` com uma API key do CCR e modelo `Claude Code API/claude-sonnet-5` retorna 200.
- [ ] Depois de atualizar o Secret `ccr-claude` e rodar `kubectl rollout restart`, o CCR passa a usar o token novo.
- [ ] Nunca existem dois pods do CCR montando o PVC ao mesmo tempo (`Recreate`).

---

## Dependências

- KCR-INFRA-001 (imagem do CCR)
- KCR-INFRA-002 (imagem do console)
- KCR-001 (namespace, PVC, Secrets)
- KCR-010 (token do Claude no Secret)

---

## Perguntas em Aberto

- Qual o domínio interno para `CCR_PUBLIC_BASE_URL`? Ele é gravado como `routerEndpoint` na config a cada inicialização.
- Quais limites de memória fazem sentido? Transcrições de cerca de 600K tokens passam pelo gateway nas chamadas do classificador do auto mode. Medir o consumo na primeira semana.
