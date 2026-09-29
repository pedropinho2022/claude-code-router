# [KCR-004] Migração do WSL e cutover dos clientes

**Status:** 🔴 Rascunho
**Epic:** Epic 1 — Implantação do CCR no cluster
**Complexidade:** M

---

## Contexto / Problema

A configuração que já funciona no WSL (`~/.claude-code-router`, serviço systemd `ccr`) tem:
- Providers: Claude Code API, Antigravity.
- Regras do **Global Routing**:
  - classificador do auto mode → `Antigravity/gemini-3.7-flash-*`, pela condição `request.body.system contains-deep "security monitor for autonomous AI coding agents"`;
  - subagentes Sonnet/Haiku, por `request.body.model contains ...`.
- API keys dos clientes.
- Os `settings.json` do Claude Code no Windows e no WSL, apontando para `http://127.0.0.1:3456`.

Tudo isso precisa ir para o pod sem perda. Depois, os dois ambientes não podem rodar ao mesmo tempo com os mesmos logins.

---

## Escopo

**Passos:**
1. No CCR do WSL: **Settings → Export data** (caminho recomendado no `docker/README.md`).
2. No CCR do pod: importar o arquivo exportado pela UI.
3. **Scan again** nos providers locais, para religar o Claude (Secret, KCR-002) e o Antigravity (`agy`, KCR-011) aos arquivos em `/data`.
4. Conferir que as regras aparecem no Global Routing na mesma ordem (classificador no topo).
5. Criar ou confirmar a API key dos clientes.
6. Trocar nos clientes:
   ```json
   "ANTHROPIC_BASE_URL": "https://ccr.<dominio>",
   "ANTHROPIC_API_BASE_URL": "https://ccr.<dominio>",
   "CLAUDE_AGENT_API_BASE_URL": "https://ccr.<dominio>",
   "ANTHROPIC_AUTH_TOKEN": "<API key do CCR do pod>"
   ```
   Isso vale para `%USERPROFILE%\.claude\settings.json` no Windows e `~/.claude/settings.json` no WSL.
7. Desligar o CCR do WSL: `systemctl --user disable --now ccr`.

**Não entra:**
- Migrar o histórico de requisições (`request-logs.sqlite`), a não ser que o export já leve.

---

## Histórias de Usuário

- Como usuário, quero levar minhas regras e API keys para o pod, para não reconfigurar tudo à mão.
- Como usuário do Claude Code no Windows e no WSL, quero trocar só a URL e a chave, para continuar trabalhando igual.

---

## Critérios de Aceite

- [ ] Todas as regras do Global Routing existem no pod, na mesma ordem e com os mesmos alvos.
- [ ] Uma sessão do Claude Code no Windows e outra no WSL funcionam contra o pod, com o CCR do WSL desligado.
- [ ] No log de requisições do pod, a chamada do classificador (`max_tokens: 2112`) sai com motivo `rule:<classificador>` e modelo Antigravity.
- [ ] Um subagente com `model: "sonnet"` aparece no log roteado para `claude-sonnet-5`.
- [ ] O serviço `ccr` do WSL fica `disabled`, e a porta 3456 no WSL fica livre.

---

## Dependências

- KCR-002, KCR-003 (CCR acessível no cluster)
- KCR-011 (login do `agy` feito no pod)

---

## Perguntas em Aberto

- O export do CCR leva os providers locais já importados, com o `sourceFile` apontando para `/home/pedropinho/...`? Se levar, pode ser preciso remover e reimportar esses providers no pod.
- Vale manter o CCR do WSL instalado e desligado como contingência? Se sim, lembrar que um novo `/login` do Claude em outro lugar pode revogar sessões (já aconteceu com o Windows).
