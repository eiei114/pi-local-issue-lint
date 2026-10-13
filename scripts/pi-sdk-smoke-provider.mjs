import { AssistantMessageEventStream } from "@earendil-works/pi-ai";

const toolName = "local_issue_lint";
const resultText = "PI_LINT_SMOKE_COMPLETE";

function responseStream(model, content, reason) {
  const stream = new AssistantMessageEventStream();
  const message = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: reason,
    timestamp: Date.now(),
  };
  stream.push({ type: "start", partial: message });

  if (content.type === "toolCall") {
    message.content.push(content);
    stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
    stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: content, partial: message });
  } else {
    message.content.push(content);
    stream.push({ type: "text_start", contentIndex: 0, partial: message });
    stream.push({ type: "text_delta", contentIndex: 0, delta: content.text, partial: message });
    stream.push({ type: "text_end", contentIndex: 0, content: content.text, partial: message });
  }

  stream.push({ type: "done", reason, message });
  stream.end();
  return stream;
}

export default function registerOfflineSmokeProvider(pi) {
  pi.registerProvider("pi-local-issue-lint-smoke", {
    name: "Pi Local Issue Lint Offline Smoke",
    api: "openai-completions",
    baseUrl: "http://127.0.0.1/offline-smoke",
    apiKey: "offline-smoke-only",
    models: [{
      id: "deterministic",
      name: "Deterministic offline smoke model",
      api: "openai-completions",
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      reasoning: false,
      contextWindow: 4096,
      maxTokens: 256,
    }],
    streamSimple(model, context) {
      const toolHasRun = context.messages.some((message) => message.role === "toolResult");
      if (toolHasRun) {
        return responseStream(model, { type: "text", text: resultText }, "stop");
      }

      const target = process.env.PI_LOCAL_ISSUE_LINT_SMOKE_TARGET;
      if (!target) throw new Error("PI_LOCAL_ISSUE_LINT_SMOKE_TARGET is required");
      return responseStream(model, {
        type: "toolCall",
        id: "pi-local-issue-lint-smoke-call",
        name: toolName,
        arguments: { target },
      }, "toolUse");
    },
  });
}
