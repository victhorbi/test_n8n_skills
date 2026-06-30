import type { EvalCase, GithubCreds } from "./types.js";
import { getContent, putContent } from "./github.js";
import { parsePrompt } from "./eval.js";

export interface GenerateConfig extends GithubCreds {
  agentFolder: string;
  branch: string | null;
  openRouterApiKey: string;
  count: number;
  model: string;
}

// Ported directly from the "Generate Evals" chainLlm prompt in 0-Generate-eval.json.
function buildPrompt(systemMessage: string, count: number): string {
  return `Given this system message for an AI agent:

${systemMessage}

Generate ${count} diverse test cases to evaluate this agent. Return ONLY a valid JSON array — no markdown, no explanation.

Each object must have exactly these fields, carefully crafted to reflect realistic user behaviour:
- id: sequential integer
- thoughts: what the user thinks before or while composing their message — their motivation, curiosity, or goal. This is internal and never sent to the agent.
- chatMessage: the user opening message to start the interaction. CRITICAL: this must be a neutral, non-revealing opener. Do NOT include the character name, gender, nationality, era, category, or any other identifying hint in this field. Use vague phrases such as: "I am ready!", "Let's play!", "I have someone in mind.", "I am thinking of something, go ahead.", "Start asking me questions!". The agent must receive zero usable information from the chatMessage alone.
- context: 1-2 sentences describing the user scenario — who the user is (age, nationality, background) and which specific character or entity they are secretly thinking of. The character name must appear here and nowhere else.

Diversity requirements:
- Vary the user age, gender, and cultural background across the set
- Vary the character category and difficulty: mix famous and obscure, fictional and real, historical and contemporary, human and non-human
- Decide what else to vary based on what the system message tells you this agent specialises in`;
}

// Ported from the "Parse and Validate" Code node in 0-Generate-eval.json.
function parseEvals(raw: string): EvalCase[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) {
    throw new Error(`No JSON array found in LLM response. Got: ${raw.slice(0, 300)}`);
  }
  let items: unknown[];
  try {
    items = JSON.parse(raw.slice(start, end + 1)) as unknown[];
  } catch (e) {
    throw new Error(`JSON parse failed: ${(e as Error).message}\nRaw: ${raw.slice(start, start + 300)}`);
  }
  if (!Array.isArray(items)) throw new Error("Expected a JSON array from LLM");

  const seen = new Set<string>();
  const valid = items
    .filter((e): e is Record<string, unknown> => {
      if (typeof e !== "object" || e === null) return false;
      const r = e as Record<string, unknown>;
      if (!r.chatMessage || !r.context || !r.thoughts) return false;
      // Deduplicate by first 60 chars of context (same logic as n8n workflow)
      const key = String(r.context).slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((e, i) => ({
      id: i + 1,
      thoughts: String(e.thoughts),
      chatMessage: String(e.chatMessage),
      context: String(e.context),
    }));

  if (valid.length < 3) {
    throw new Error(`Too few valid eval cases after filtering: ${valid.length} (need ≥3)`);
  }
  return valid;
}

/**
 * Generate and commit an eval set for a new agent.
 *
 * Idempotent: if evals/eval-set.json already exists on the branch, exits early.
 * Returns true if a new eval set was generated and committed, false if skipped.
 */
export async function generateEvalSet(cfg: GenerateConfig): Promise<boolean> {
  const evalSetPath = `${cfg.agentFolder}/evals/eval-set.json`;
  const promptPath = `${cfg.agentFolder}/system-prompt.md`;

  // Idempotency check — skip if eval set already exists on this branch
  try {
    await getContent(cfg, evalSetPath, cfg.branch);
    console.log(`eval-set.json already exists for ${cfg.agentFolder} — skipping generation.`);
    return false;
  } catch (e) {
    if (!String(e).includes("404")) throw e;
    // 404 → file doesn't exist yet, proceed
  }

  // Read system-prompt.md (strip QUALITY_SCORE header if present)
  const promptFile = await getContent(cfg, promptPath, cfg.branch);
  const { cleanPrompt } = parsePrompt(promptFile.decoded);

  console.log(`Generating ${cfg.count} eval cases for ${cfg.agentFolder} using ${cfg.model}…`);

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/agent-eval",
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.7,
      messages: [{ role: "user", content: buildPrompt(cleanPrompt, cfg.count) }],
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter error ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  const raw = data.choices?.[0]?.message?.content ?? "";
  if (!raw) throw new Error("Empty response from LLM");

  const evals = parseEvals(raw);

  const agentName = cfg.agentFolder.replace(/^agents\//, "");
  await putContent(cfg, {
    path: evalSetPath,
    content: JSON.stringify(evals, null, 2),
    message: `chore: generate eval set for ${agentName} (${evals.length} cases) [auto-gen]`,
    branch: cfg.branch,
    // no sha — always a new file at this point
  });

  console.log(`✓ Committed ${evals.length} eval cases → ${evalSetPath}`);
  return true;
}
