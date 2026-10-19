import { isRecord } from "@ccr/core/gateway/internal/value";

/**
 * Thinking blocks carry a signature bound to the model that produced them.
 * When a conversation moves between models or providers (router rules, model
 * switches, imported history) Anthropic rejects the next request with
 * `Invalid signature in thinking block`. The blocks are only a replay of past
 * reasoning, so dropping them and retrying once keeps the conversation going.
 */
export function isInvalidThinkingSignatureError(status: number, bodyText: string): boolean {
  if (status !== 400) {
    return false;
  }
  const text = bodyText.toLowerCase();
  return text.includes("signature") && text.includes("thinking");
}

/**
 * Returns a copy of an Anthropic Messages request body without `thinking` and
 * `redacted_thinking` content blocks, or undefined when there is nothing to strip.
 */
export function stripThinkingBlocksFromMessagesBody(body: Buffer | undefined): Buffer | undefined {
  if (!body) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.messages)) {
    return undefined;
  }

  let stripped = false;
  const messages: unknown[] = [];
  for (const message of parsed.messages) {
    if (!isRecord(message) || !Array.isArray(message.content)) {
      messages.push(message);
      continue;
    }
    const content = message.content.filter((block) => !isThinkingBlock(block));
    if (content.length === message.content.length) {
      messages.push(message);
      continue;
    }
    stripped = true;
    // A message that held only reasoning has nothing left to replay.
    if (content.length > 0) {
      messages.push({ ...message, content });
    }
  }
  if (!stripped) {
    return undefined;
  }

  const next: Record<string, unknown> = { ...parsed, messages };
  // An assistant turn that called a tool must start with a thinking block while
  // extended thinking is enabled, so disable it for this retry in that case.
  if (isRecord(next.thinking) && next.thinking.type !== "disabled" && lastAssistantCalledTool(messages)) {
    delete next.thinking;
  }
  return Buffer.from(JSON.stringify(next), "utf8");
}

function isThinkingBlock(block: unknown): boolean {
  return isRecord(block) && (block.type === "thinking" || block.type === "redacted_thinking");
}

function lastAssistantCalledTool(messages: unknown[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isRecord(message) && message.role === "assistant") {
      return Array.isArray(message.content) && message.content.some((block) => isRecord(block) && block.type === "tool_use");
    }
  }
  return false;
}
