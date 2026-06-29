import type { Config, EvalCase, GameResult, QualityStats } from "./types.js";
import { getContent, putContent, markPullRequestReady } from "./github.js";
import { runGames } from "./game.js";

const QUALITY_BLOCK_RE = /<!--\s*QUALITY_SCORE([\s\S]*?)-->\s*\n*/;

/** Extract the embedded QUALITY_SCORE baseline (if any) and return the prompt without it. */
export function parsePrompt(raw: string): { baseline: QualityStats | null; cleanPrompt: string } {
  let baseline: QualityStats | null = null;
  const m = raw.match(/<!--\s*QUALITY_SCORE([\s\S]*?)-->/);
  if (m) {
    try {
      baseline = JSON.parse(m[1].trim()) as QualityStats;
    } catch {
      baseline = null;
    }
  }
  const cleanPrompt = raw.replace(new RegExp(QUALITY_BLOCK_RE.source, "g"), "").trim();
  return { baseline, cleanPrompt };
}

export interface EvalReport {
  results: GameResult[];
  stats: QualityStats;
  baseline: QualityStats | null;
  firstRun: boolean;
  improved: boolean;
  updatedPrompt: string;
  promptPath: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Compute aggregate stats and the new prompt from raw game results. */
export function aggregate(
  cfg: Config,
  results: GameResult[],
  baseline: QualityStats | null,
  cleanPrompt: string,
): Omit<EvalReport, "results" | "promptPath"> {
  if (results.length === 0) throw new Error("No eval results to aggregate");

  const successes = results.filter((r) => r.success);
  const successRate = round1((successes.length / results.length) * 100);
  const avgIter = round1(results.reduce((s, r) => s + r.iterations, 0) / results.length);
  const totalTokens = results.reduce((s, r) => s + r.tokens_used, 0);
  const tokensPerGame = Math.round(totalTokens / results.length);

  const firstRun = !baseline;
  const stats: QualityStats = {
    model: cfg.userModel,
    total_games: results.length,
    successful_games: successes.length,
    success_rate: successRate,
    avg_iterations: avgIter,
    total_tokens: totalTokens,
    tokens_per_game: tokensPerGame,
    evaluated_at: new Date().toISOString(),
    first_run: firstRun,
    thresholds_used: firstRun
      ? { min_success_rate: cfg.minSuccessRate, max_avg_iterations: cfg.maxAvgIterations }
      : null,
  };

  const improved = firstRun
    ? successRate >= cfg.minSuccessRate && avgIter <= cfg.maxAvgIterations
    : successRate > Number(baseline!.success_rate ?? 0) &&
      avgIter < Number(baseline!.avg_iterations ?? Infinity);

  const updatedPrompt = `<!-- QUALITY_SCORE\n${JSON.stringify(stats, null, 2)}\n-->\n\n${cleanPrompt}`;

  return { stats, baseline, firstRun, improved, updatedPrompt };
}

/** End-to-end run: fetch -> games -> aggregate -> (optionally) commit + mark PR ready. */
export async function runEval(cfg: Config): Promise<EvalReport> {
  const readRef = cfg.branch ?? "main";
  const evalSetPath = `${cfg.agentFolder}/evals/eval-set.json`;
  const promptPath = `${cfg.agentFolder}/system-prompt.md`;

  const [evalFile, promptFile] = await Promise.all([
    getContent(cfg, evalSetPath, readRef),
    getContent(cfg, promptPath, readRef),
  ]);

  let cases: EvalCase[];
  try {
    cases = JSON.parse(evalFile.decoded) as EvalCase[];
  } catch (e) {
    throw new Error(`Could not parse eval set: ${(e as Error).message}`);
  }
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error("Eval set is empty or not an array");
  }

  const { baseline, cleanPrompt } = parsePrompt(promptFile.decoded);

  const runId = `${cfg.prNumber ?? "manual"}-${Date.now()}`;
  console.log(`Running ${cases.length} games on ${cfg.agentFolder} @ ${readRef} (concurrency ${cfg.concurrency})`);
  const results = await runGames(cfg, cases, cleanPrompt, runId);

  const agg = aggregate(cfg, results, baseline, cleanPrompt);
  const report: EvalReport = { ...agg, results, promptPath };

  if (cfg.dryRun) {
    console.log("DRY RUN: skipping commit and PR update.");
    return report;
  }

  if (cfg.commit) {
    await putContent(cfg, {
      path: promptPath,
      content: report.updatedPrompt,
      message: "chore: update quality score on system prompt [auto-eval]",
      branch: cfg.branch,
      sha: promptFile.sha,
    });
    console.log(`Committed updated quality score to ${promptPath} on ${cfg.branch ?? "default branch"}`);
  }

  if (report.improved && cfg.prNumber !== null) {
    await markPullRequestReady(cfg, cfg.prNumber);
    console.log(`Marked PR #${cfg.prNumber} ready for review.`);
  }

  return report;
}
