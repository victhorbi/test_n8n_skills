import { appendFileSync } from "node:fs";
import { loadConfig, assertRunnable } from "./config.js";
import { runEval, type EvalReport } from "./eval.js";
import type { Config } from "./types.js";

function renderSummary(cfg: Config, r: EvalReport): string {
  const b = r.baseline;
  const lines = [
    `## Agent eval — ${cfg.agentFolder}`,
    "",
    `Ref: \`${cfg.branch ?? "main"}\`${cfg.prNumber ? ` · PR #${cfg.prNumber}` : ""} · ${r.firstRun ? "first run" : "vs baseline"}`,
    "",
    "| Metric | Result | Baseline |",
    "|---|---|---|",
    `| Success rate | ${r.stats.success_rate}% | ${b ? b.success_rate + "%" : "—"} |`,
    `| Avg iterations | ${r.stats.avg_iterations} | ${b ? b.avg_iterations : "—"} |`,
    `| Successful games | ${r.stats.successful_games}/${r.stats.total_games} | — |`,
    `| Tokens / game | ${r.stats.tokens_per_game} | ${b ? b.tokens_per_game : "—"} |`,
    "",
    `**Verdict: ${r.improved ? "✅ improved" : "❌ not improved"}**`,
  ];
  if (r.firstRun) {
    lines.push(
      "",
      `_Thresholds: success ≥ ${cfg.minSuccessRate}%, avg iterations ≤ ${cfg.maxAvgIterations}_`,
    );
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  assertRunnable(cfg);

  const report = await runEval(cfg);

  const summary = renderSummary(cfg, report);
  console.log("\n" + summary + "\n");

  // GitHub Actions job summary
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
    } catch {
      /* non-fatal */
    }
  }

  // Machine-readable line for downstream tooling.
  console.log("EVAL_RESULT_JSON " + JSON.stringify({ stats: report.stats, improved: report.improved }));

  if (cfg.failOnRegression && !report.improved) {
    console.error("Quality did not improve — failing the check.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
