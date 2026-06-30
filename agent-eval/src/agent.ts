import type { Config } from "./types.js";

export interface AgentCallInput {
  chatInput: string;
  sessionId: string;
  /** PR branch being tested. Omitted (null) when not in a PR context; the n8n
   *  agent workflow falls back to `main` and fetches the system prompt from there. */
  branch: string | null;
  /** GitHub coordinates so the n8n agent can fetch system-prompt.md itself. */
  owner: string;
  repo: string;
  agentFolder: string;
}

/**
 * Call the agent under test, hosted as an n8n chat webhook.
 *
 * Contract (eval-core -> n8n):
 *   POST <N8N_AGENT_WEBHOOK_URL>
 *   { action: "sendMessage", chatInput, sessionId, owner, repo, agentFolder, branch? }
 *
 * The n8n agent workflow is responsible for fetching its own system-prompt.md from
 *   https://raw.githubusercontent.com/{owner}/{repo}/{branch ?? "main"}/{agentFolder}/system-prompt.md
 * and stripping the QUALITY_SCORE header before use. `branch` is omitted when null;
 * the workflow must default to "main" in that case.
 *
 * Expected response JSON, first match wins:
 *   { output } | { text } | { response } | { data: { output } }
 *
 * `sessionId` MUST be stable within a game and unique per game so the agent's
 * memory isolates conversations.
 */
export async function callAgent(cfg: Config, input: AgentCallInput): Promise<string> {
  const payload: Record<string, unknown> = {
    action: "sendMessage",
    chatInput: input.chatInput,
    sessionId: input.sessionId,
    owner: input.owner,
    repo: input.repo,
    agentFolder: input.agentFolder,
  };
  if (input.branch !== null) payload.branch = input.branch;

  const res = await fetch(cfg.n8nAgentWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`agent webhook failed: ${res.status} ${raw.slice(0, 500)}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    // Some n8n setups return the bare string.
    return raw.trim();
  }

  const out = extractOutput(data);
  if (out === null) {
    throw new Error(`agent webhook returned no recognizable output field: ${raw.slice(0, 300)}`);
  }
  return out;
}

function extractOutput(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (Array.isArray(data) && data.length) return extractOutput(data[0]);
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const key of ["output", "text", "response", "answer", "message"]) {
      const v = o[key];
      if (typeof v === "string") return v;
    }
    if (o.data) return extractOutput(o.data);
    if (o.json) return extractOutput(o.json);
  }
  return null;
}
