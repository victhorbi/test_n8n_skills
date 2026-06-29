import type { Config, Usage } from "./types.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * Build the simulated user's system message. Mirrors the n8n "User" agent prompt:
 * the user plays a role defined by `context`, drives the conversation per `thoughts`,
 * and emits exactly "succeed" once the task feels complete.
 */
export function buildUserSystemMessage(context: string, thoughts: string): string {
  return [
    "You are interpreting the role of the user inside an Agent test.",
    "",
    "The prompts you need to answer to are coming from an AI agent.",
    "",
    "Some Context that you, as the user, need to interpret:",
    `"${context}"`,
    "",
    "Your initial stream of thoughts:",
    `"${thoughts}"`,
    "",
    'If you think you had a complete interaction and the task has been completely satisfied, your output must be "succeed".',
  ].join("\n");
}

export interface UserTurn {
  text: string;
  usage: Usage;
}

/**
 * Produce the simulated user's reply to the agent's latest message.
 * `history` is the running transcript from the user's point of view
 * (agent messages are `user` role, the simulated user's own replies are `assistant`).
 * The caller mutates `history` across turns to preserve memory.
 */
export async function callUser(
  cfg: Config,
  args: { context: string; thoughts: string; agentMessage: string; history: ChatMessage[] },
): Promise<UserTurn> {
  const { context, thoughts, agentMessage, history } = args;

  const messages: ChatMessage[] = [
    { role: "system", content: buildUserSystemMessage(context, thoughts) },
    ...history,
    { role: "user", content: agentMessage },
  ];

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.openRouterApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: cfg.userModel, messages }),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`OpenRouter failed: ${res.status} ${raw.slice(0, 500)}`);
  }

  const data = JSON.parse(raw) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const text = (data.choices?.[0]?.message?.content ?? "").trim();
  const usage: Usage = {
    prompt_tokens: data.usage?.prompt_tokens ?? 0,
    completion_tokens: data.usage?.completion_tokens ?? 0,
    total_tokens: data.usage?.total_tokens ?? 0,
  };

  // Update the user's memory of the exchange.
  history.push({ role: "user", content: agentMessage });
  history.push({ role: "assistant", content: text });

  return { text, usage };
}
