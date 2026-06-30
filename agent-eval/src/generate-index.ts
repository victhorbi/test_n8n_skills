import { generateEvalSet } from "./generate.js";

function require(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function main(): Promise<void> {
  const cfg = {
    owner:           require("OWNER"),
    repo:            require("REPO"),
    agentFolder:     require("AGENT_FOLDER").replace(/\/$/, ""), // strip trailing slash
    branch:          process.env.BRANCH ?? null,
    githubToken:     require("GITHUB_TOKEN"),
    openRouterApiKey: require("OPENROUTER_API_KEY"),
    count:           parseInt(process.env.EVAL_COUNT ?? "10", 10),
    model:           process.env.EVAL_GEN_MODEL ?? "openai/gpt-5.4-mini",
  };

  const generated = await generateEvalSet(cfg);
  if (!generated) process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
