import type { Config } from "./types.js";

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v === "") return dflt;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function num(v: string | undefined, dflt: number): number {
  if (v === undefined || v === "") return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** Parse `--key value` and `--key=value` style flags into a map. */
function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[a.slice(2)] = next;
        i++;
      } else {
        out[a.slice(2)] = "true";
      }
    }
  }
  return out;
}

/**
 * Resolve config from environment variables, overridable by CLI flags.
 * Required at runtime: GITHUB_TOKEN, OPENROUTER_API_KEY, N8N_AGENT_WEBHOOK_URL, OWNER, REPO.
 */
export function loadConfig(argv: string[] = process.argv.slice(2)): Config {
  const args = parseArgs(argv);
  const env = process.env;

  const pick = (k: string, e: string) => args[k] ?? env[e];

  const branchRaw = pick("branch", "BRANCH");
  const prRaw = pick("pr-number", "PR_NUMBER");

  const cfg: Config = {
    owner: pick("owner", "OWNER") ?? "",
    repo: pick("repo", "REPO") ?? "",
    agentFolder: pick("agent-folder", "AGENT_FOLDER") ?? "agents/akinator",
    branch: branchRaw && branchRaw !== "null" ? branchRaw : null,
    prNumber: prRaw && prRaw !== "null" ? num(prRaw, NaN) : null,

    maxIterations: num(pick("max-iterations", "MAX_ITERATIONS"), 40),
    minSuccessRate: num(pick("min-success-rate", "MIN_SUCCESS_RATE"), 50),
    maxAvgIterations: num(pick("max-avg-iterations", "MAX_AVG_ITERATIONS"), 30),

    userModel: pick("user-model", "USER_MODEL") ?? "deepseek/deepseek-v4-flash",

    githubToken: env.GITHUB_TOKEN ?? env.GH_TOKEN ?? "",
    openRouterApiKey: env.OPENROUTER_API_KEY ?? "",
    n8nAgentWebhookUrl: env.N8N_AGENT_WEBHOOK_URL ?? "",

    commit: bool(pick("commit", "COMMIT"), true),
    dryRun: bool(pick("dry-run", "DRY_RUN"), false),
    failOnRegression: bool(pick("fail-on-regression", "FAIL_ON_REGRESSION"), false),
    concurrency: Math.max(1, num(pick("concurrency", "CONCURRENCY"), 1)),
  };

  if (Number.isNaN(cfg.prNumber as number)) cfg.prNumber = null;
  return cfg;
}

/** Throw a clear error if anything required to actually run is missing. */
export function assertRunnable(cfg: Config): void {
  const missing: string[] = [];
  if (!cfg.owner) missing.push("OWNER");
  if (!cfg.repo) missing.push("REPO");
  if (!cfg.githubToken) missing.push("GITHUB_TOKEN");
  if (!cfg.openRouterApiKey) missing.push("OPENROUTER_API_KEY");
  if (!cfg.n8nAgentWebhookUrl) missing.push("N8N_AGENT_WEBHOOK_URL");
  if (missing.length) {
    throw new Error(`Missing required configuration: ${missing.join(", ")}`);
  }
}
