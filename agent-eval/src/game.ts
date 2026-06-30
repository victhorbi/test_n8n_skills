import type { Config, EvalCase, GameResult } from "./types.js";
import { callAgent } from "./agent.js";
import { callUser } from "./user.js";

/** Matches the original n8n exit signal from the simulated user. */
const SUCCESS_REGEX = /succeed|success|satisfied/i;

/**
 * Run one eval case to completion.
 *
 * Turn order per iteration (mirrors n8n "1 - Run Eval"):
 *   1. agent under test responds to the current message
 *   2. simulated user replies
 *   3. if the user signals success -> game won; if iteration budget is exhausted -> game lost
 *
 * Difference from the n8n version: success is tied to the user actually signalling
 * satisfaction, not merely to `iterations < max`. This fixes the corner case where the
 * user said "succeed" exactly on the final allowed iteration and was wrongly scored a loss.
 */
export async function runGame(
  cfg: Config,
  evalCase: EvalCase,
  runId: string,
): Promise<GameResult> {
  const sessionId = `${runId}:${evalCase.id}`;
  const transcript: GameResult["transcript"] = [];
  const userHistory: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];

  let chatInput = evalCase.chatMessage;
  let iterations = 0;
  let success = false;
  let tokensUsed = 0;

  while (true) {
    const agentText = await callAgent(cfg, {
      chatInput,
      sessionId,
      branch: cfg.branch,
      owner: cfg.owner,
      repo: cfg.repo,
      agentFolder: cfg.agentFolder,
    });
    transcript.push({ role: "agent", text: agentText });

    const userTurn = await callUser(cfg, {
      context: evalCase.context,
      thoughts: evalCase.thoughts,
      agentMessage: agentText,
      history: userHistory,
    });
    transcript.push({ role: "user", text: userTurn.text });
    tokensUsed += userTurn.usage.total_tokens;

    iterations++;

    const satisfied = SUCCESS_REGEX.test(userTurn.text);
    if (satisfied || iterations >= cfg.maxIterations) {
      success = satisfied;
      break;
    }

    chatInput = userTurn.text;
  }

  return { id: evalCase.id, iterations, success, tokens_used: tokensUsed, transcript };
}

/** Run an array of games with a bounded concurrency (default 1 = sequential). */
export async function runGames(
  cfg: Config,
  cases: EvalCase[],
  runId: string,
): Promise<GameResult[]> {
  const results: GameResult[] = new Array(cases.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < cases.length) {
      const i = cursor++;
      const c = cases[i];
      try {
        results[i] = await runGame(cfg, c, runId);
      } catch (err) {
        // A crashed game counts as a failed game rather than aborting the whole run.
        const message = err instanceof Error ? err.message : String(err);
        console.error(`game ${c.id} errored: ${message}`);
        results[i] = {
          id: c.id,
          iterations: cfg.maxIterations,
          success: false,
          tokens_used: 0,
          error: message,
          transcript: [{ role: "user", text: `ERROR: ${message}` }],
        };
      }
    }
  }

  const workers = Array.from({ length: Math.min(cfg.concurrency, cases.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
