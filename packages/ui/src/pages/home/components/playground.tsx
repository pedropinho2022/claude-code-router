import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import type { GatewayProviderConfig, PlaygroundChatResult, VirtualModelProfileConfig } from "@ccr/core/contracts/app";
import {
  Button, Card, CardContent, CardHeader, cn, LoaderCircle, motion, Textarea, Trash2, useAppText
} from "../shared/index";
import { ModelSelector } from "./model-selector";

type PlaygroundMessage =
  | { content: string; role: "user" }
  | { content: string; meta?: PlaygroundChatResult; role: "assistant" }
  | { content: string; role: "error" };

// Plain chat against the CCR gateway: no tools, no agent harness. The history
// lives only in this view's memory and is sent in full on every turn.
export function PlaygroundView({
  providers,
  virtualModelProfiles
}: {
  providers: GatewayProviderConfig[];
  virtualModelProfiles: VirtualModelProfileConfig[];
}) {
  const t = useAppText();
  const [model, setModel] = useState("");
  const [system, setSystem] = useState("");
  const [showSystem, setShowSystem] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<PlaygroundMessage[]>([]);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ behavior: "smooth", top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

  async function send() {
    const content = input.trim();
    const api = window.ccr;
    if (!content || !model || sending || !api) {
      return;
    }
    const next: PlaygroundMessage[] = [...messages, { content, role: "user" }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const result = await api.sendPlaygroundChat({
        messages: next
          .filter((message): message is Extract<PlaygroundMessage, { role: "assistant" | "user" }> =>
            message.role === "user" || message.role === "assistant")
          .map((message) => ({ content: message.content, role: message.role })),
        model,
        system: system.trim() || undefined
      });
      setMessages((current) => [...current, { content: result.text || t("(empty response)"), meta: result, role: "assistant" }]);
    } catch (error) {
      setMessages((current) => [...current, { content: error instanceof Error ? error.message : String(error), role: "error" }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="flex h-full min-h-0 min-w-0 flex-col"
      initial={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <Card className="flex h-full min-h-0 min-w-0 flex-col">
        <CardHeader className="flex-row flex-wrap items-center gap-2">
          <div className="min-w-[220px] flex-1">
            <ModelSelector
              onChange={setModel}
              placeholder={t("Select a model")}
              providers={providers}
              value={model}
              virtualModelProfiles={virtualModelProfiles}
            />
          </div>
          <Button onClick={() => setShowSystem((value) => !value)} size="sm" variant={showSystem || system.trim() ? "secondary" : "outline"}>
            {t("System prompt")}
          </Button>
          <Button disabled={messages.length === 0 || sending} onClick={() => setMessages([])} size="sm" variant="outline">
            <Trash2 className="h-3.5 w-3.5" />
            {t("New chat")}
          </Button>
        </CardHeader>
        {showSystem ? (
          <div className="px-6 pb-3">
            <Textarea
              aria-label={t("System prompt")}
              className="min-h-[72px] text-sm"
              onChange={(event) => setSystem(event.target.value)}
              placeholder={t("Optional system prompt")}
              value={system}
            />
          </div>
        ) : null}
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" ref={scrollRef}>
            {messages.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {t("Pick a model and send a message. Requests go through CCR routing; the chat is kept only in memory.")}
              </p>
            ) : null}
            {messages.map((message, index) => (
              <PlaygroundBubble key={index} message={message} />
            ))}
            {sending ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                {t("Waiting for the model…")}
              </div>
            ) : null}
          </div>
          <div className="flex items-end gap-2">
            <Textarea
              aria-label={t("Message")}
              className="max-h-48 min-h-[44px] flex-1 text-sm"
              disabled={sending}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={model ? t("Message (Enter to send, Shift+Enter for a new line)") : t("Select a model first")}
              value={input}
            />
            <Button aria-label={t("Send")} disabled={!model || !input.trim() || sending} onClick={() => void send()}>
              {sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function PlaygroundBubble({ message }: { message: PlaygroundMessage }) {
  const t = useAppText();
  if (message.role === "error") {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {message.content}
      </div>
    );
  }
  const isUser = message.role === "user";
  const meta = message.role === "assistant" ? message.meta : undefined;
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn(
        "max-w-[85%] rounded-lg px-3 py-2 text-sm",
        isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
      )}>
        {meta?.thinking ? (
          <details className="mb-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">{t("Thinking")}</summary>
            <p className="mt-1 whitespace-pre-wrap">{meta.thinking}</p>
          </details>
        ) : null}
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        {meta ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {[
              meta.routedModel ?? meta.model,
              meta.routeReason,
              meta.inputTokens !== undefined ? `${meta.inputTokens} in` : undefined,
              meta.outputTokens !== undefined ? `${meta.outputTokens} out` : undefined,
              `${(meta.durationMs / 1000).toFixed(1)} s`,
              meta.stopReason && meta.stopReason !== "end_turn" ? meta.stopReason : undefined
            ].filter(Boolean).join(" · ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
