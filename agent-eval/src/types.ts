// Shared types for the agent eval harness.

/** A single eval case as stored in `<agent_folder>/evals/eval-set.json`. */
export interface EvalCase {
  id: number;
  /** First message the simulated user sends to the agent. */
  chatMessage: string;
  /** Hidden context the simulated user is role-playing (e.g. the secret answer). */
  context: string;
  /** The simulated user's standing intent / stream of thoughts. */
  thoughts: string;
}

/** The QUALITY_SCORE block embedded as an HTML comment at the top of system-prompt.md. */
export interface QualityStats {
  model: string;
  total_games: number;
  valid_games: number;
  errored_games: number;
  successful_games: number;
  success_rate: number; // percentage, one decimal — computed over valid games only
  avg_iterations: number; // one decimal — computed over valid games only
  total_tokens: number;
  tokens_per_game: number;
  evaluated_at: string; // ISO timestamp
  first_run?: boolean;
  thresholds_used?: { min_success_rate: number; max_avg_iterations: number } | null;
}

/** Result of running one game (one eval case) to completion. */
export interface GameResult {
  id: number;
  iterations: number;
  success: boolean;
  tokens_used: number;
  /** Set when the game crashed rather than completing normally. */
  error?: string;
  /** Full turn-by-turn transcript, useful for debugging in CI logs. */
  transcript: Array<{ role: "agent" | "user"; text: string }>;
}

/** Token accounting for a single LLM call. */
export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Minimal GitHub credentials — accepted by all github.ts helpers. */
export interface GithubCreds {
  owner: string;
  repo: string;
  githubToken: string;
}

/** Fully-resolved run configuration (env + CLI merged). */
export interface Config extends GithubCreds {
  owner: string;
  repo: string;
  agentFolder: string;
  /** Branch under test (PR head ref). Falls back to `main` for reads. */
  branch: string | null;
  prNumber: number | null;

  maxIterations: number;
  minSuccessRate: number;
  maxAvgIterations: number;

  /** Model label recorded in the quality score (the simulated user's model). */
  userModel: string;

  // Credentials / endpoints
  githubToken: string;
  openRouterApiKey: string;
  n8nAgentWebhookUrl: string;

  // Behaviour flags
  /** Write the updated QUALITY_SCORE back to the repo. */
  commit: boolean;
  /** Run everything but never write to GitHub (no commit, no PR change). */
  dryRun: boolean;
  /** Exit non-zero when quality did not improve (gates the PR check). */
  failOnRegression: boolean;
  /** Max games to run in parallel. 1 = sequential (safest for rate limits). */
  concurrency: number;
}
