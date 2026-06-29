import assert from "node:assert/strict";
import { parsePrompt, aggregate } from "../src/eval.js";
import type { Config, GameResult, QualityStats } from "../src/types.js";

function baseConfig(over: Partial<Config> = {}): Config {
  return {
    owner: "o",
    repo: "r",
    agentFolder: "agents/akinator",
    branch: null,
    prNumber: null,
    maxIterations: 40,
    minSuccessRate: 50,
    maxAvgIterations: 30,
    userModel: "deepseek/deepseek-v4-flash",
    githubToken: "x",
    openRouterApiKey: "x",
    n8nAgentWebhookUrl: "x",
    commit: false,
    dryRun: true,
    failOnRegression: false,
    concurrency: 1,
    ...over,
  };
}

function game(id: number, iterations: number, success: boolean, tokens = 0): GameResult {
  return { id, iterations, success, tokens_used: tokens, transcript: [] };
}

// --- parsePrompt ---
{
  const stats: QualityStats = {
    model: "m",
    total_games: 10,
    successful_games: 6,
    success_rate: 60,
    avg_iterations: 12,
    total_tokens: 0,
    tokens_per_game: 0,
    evaluated_at: "2026-01-01T00:00:00.000Z",
  };
  const raw = `<!-- QUALITY_SCORE\n${JSON.stringify(stats, null, 2)}\n-->\n\nYou are an agent.`;
  const { baseline, cleanPrompt } = parsePrompt(raw);
  assert.equal(baseline?.success_rate, 60);
  assert.equal(cleanPrompt, "You are an agent.");
  console.log("ok: parsePrompt extracts baseline and strips block");
}
{
  const { baseline, cleanPrompt } = parsePrompt("No header here.");
  assert.equal(baseline, null);
  assert.equal(cleanPrompt, "No header here.");
  console.log("ok: parsePrompt handles missing header");
}

// --- aggregate: first run ---
{
  const cfg = baseConfig();
  const results = [game(1, 10, true), game(2, 20, true), game(3, 40, false), game(4, 8, true)];
  const r = aggregate(cfg, results, null, "PROMPT");
  assert.equal(r.firstRun, true);
  assert.equal(r.stats.success_rate, 75); // 3/4
  assert.equal(r.stats.avg_iterations, 19.5); // (10+20+40+8)/4
  assert.equal(r.improved, true); // 75>=50 and 19.5<=30
  assert.ok(r.updatedPrompt.startsWith("<!-- QUALITY_SCORE"));
  assert.ok(r.updatedPrompt.endsWith("PROMPT"));
  console.log("ok: aggregate first-run pass");
}

// --- aggregate: first run fails threshold ---
{
  const cfg = baseConfig({ minSuccessRate: 80 });
  const results = [game(1, 10, true), game(2, 20, false)];
  const r = aggregate(cfg, results, null, "P");
  assert.equal(r.improved, false); // 50 < 80
  console.log("ok: aggregate first-run threshold fail");
}

// --- aggregate: vs baseline, improved ---
{
  const cfg = baseConfig();
  const baseline: QualityStats = {
    model: "m",
    total_games: 4,
    successful_games: 2,
    success_rate: 50,
    avg_iterations: 25,
    total_tokens: 0,
    tokens_per_game: 0,
    evaluated_at: "2026-01-01T00:00:00.000Z",
  };
  const results = [game(1, 10, true), game(2, 12, true), game(3, 30, false), game(4, 8, true)];
  const r = aggregate(cfg, results, baseline, "P");
  assert.equal(r.firstRun, false);
  assert.equal(r.stats.success_rate, 75); // > 50
  assert.equal(r.improved, true); // 75>50 and 15<25
  console.log("ok: aggregate vs baseline improved");
}

// --- aggregate: vs baseline, regression (better rate but slower) ---
{
  const cfg = baseConfig();
  const baseline: QualityStats = {
    model: "m",
    total_games: 4,
    successful_games: 2,
    success_rate: 50,
    avg_iterations: 10,
    total_tokens: 0,
    tokens_per_game: 0,
    evaluated_at: "2026-01-01T00:00:00.000Z",
  };
  const results = [game(1, 20, true), game(2, 20, true), game(3, 20, true), game(4, 20, false)];
  const r = aggregate(cfg, results, baseline, "P");
  assert.equal(r.improved, false); // rate up (75>50) but avg 20 !< 10
  console.log("ok: aggregate vs baseline regression on iterations");
}

console.log("\nAll unit tests passed.");
