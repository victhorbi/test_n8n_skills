# Agent Self-Improvement System

A framework for building AI conversational agents that evaluate and improve themselves automatically. You write the initial agent definition; the system handles evaluation, scoring, and — over time — proposes its own improvements.

The Akinator agent in this repo is the reference implementation. The framework is agent-agnostic: add any agent under `agents/` and the full pipeline activates for it automatically.

---

## How It Works

```
Developer writes system-prompt.md
         │
         ▼
CI generates eval-set.json (once per new agent)
         │
         ▼
Open PR  ◄──────────────────────────────────────────────────────┐
         │                                                       │
         ▼                                                       │
GitHub Actions runs eval harness                                │
  • Fetches eval set + system prompt from the PR branch         │
  • Runs N games in parallel (agent + user simulator)           │
  • Requires ≥80% of games to complete without error            │
  • Computes: success rate, avg turns, tokens/game              │
  • Commits QUALITY_SCORE header to system-prompt.md            │
  • If quality improved → marks PR ready for review             │
         │                                                       │
         ▼                                                       │
Developer reviews + merges PR                                   │
         │                                                       │
         ▼                                                       │
Stale logs are deleted automatically (clean-eval-logs)          │
         │                                                       │
         ▼                                                       │
After N merged PRs: analyze-and-improve fires automatically     │
  • Reads current agent files + last N conversation logs        │
  • LLM identifies failure patterns by priority (see below)     │
  • LLM applies targeted edits to system-prompt + skills        │
  • Opens a draft PR with the improvements ──────────────────────┘
```

---

## Repository Structure

```
├── agents/
│   └── akinator/
│       ├── system-prompt.md          # Agent definition (may include QUALITY_SCORE header)
│       └── evals/
│           ├── eval-set.json         # Test scenarios (auto-generated, committed to repo)
│           └── logs/                 # Conversation logs per eval run (auto-generated)
│               └── 2026-01-15T14-30-00-42-manual.json
│
├── skills/                           # Shared skill files, loaded by the agent at runtime
│   ├── candidate-state-manager.md
│   ├── entropy-calculator.md
│   ├── confidence-threshold-check.md
│   └── knowledge-base-resolver.md
│
├── agent-eval/                       # TypeScript eval harness (runs in GitHub Actions)
│   └── src/
│       ├── eval.ts                   # Orchestrates a full eval run
│       ├── game.ts                   # Single game loop (agent call + user sim)
│       ├── generate.ts               # Eval set generation logic
│       ├── github.ts                 # GitHub Contents API helpers
│       └── types.ts                  # Shared interfaces
│
├── workflows/                        # Importable n8n workflow JSON files
│   ├── evaluate-pr.json              # Quality gate (legacy n8n path, superseded by CI)
│   ├── generate-eval-set.json        # Generate test cases (called by CI)
│   ├── edit-system-prompt-pr.json    # AI-edit a prompt and open a PR
│   ├── run-single-eval.json          # Run one game interactively
│   └── analyze-and-improve.json     # Analyze logs and create improvement PR
│
└── .github/
    └── workflows/
        ├── agent-eval.yml            # Run eval on every PR touching agents/ or skills/
        ├── generate-eval-set.yml     # Auto-generate eval set when a new agent is added
        ├── clean-eval-logs.yml       # Delete stale logs after a prompt/skills merge
        └── auto-analyze.yml         # Trigger analyze-and-improve after N sessions
```

---

## Adding a New Agent

1. Create `agents/<your-agent>/system-prompt.md` with your agent definition.
2. Open a PR — the `generate-eval-set` workflow detects the new file and commits `evals/eval-set.json` to your branch automatically (requires the `N8N_AGENT_<NAME>_WEBHOOK_URL` secret to exist first — see Setup).
3. The eval harness runs once the eval set is committed, scores the agent, and writes the `QUALITY_SCORE` header.
4. Review and merge. The improvement loop is now active for your agent.

**Skill changes** automatically re-evaluate all agents on the same PR.

---

## Improvement Priority

When `analyze-and-improve` runs, it inspects conversation logs and proposes fixes in this order. Higher priorities are mandatory — they appear in every PR where they are found, regardless of whether lower-priority improvements also exist.

| Priority | Area | What triggers it |
|---|---|---|
| **1 — Critical** | **Credentials or secrets exposed** | Any API key, password, private key, or token appearing in agent output — including in chain-of-thought. Must never be printed. |
| **1 — Critical** | **System prompt or skill file contents leaked** | Agent quotes or paraphrases its own instructions or skill file text. |
| **1 — Critical** | **User hidden context exposed** | Agent reveals the eval's hidden `context` or `thoughts` fields, which the simulated user never sends. |
| **1 — Critical** | **Raw tool output surfaced** | Agent forwards API responses, file payloads, or raw JSON from tool calls to the user. |
| **2 — High** | **Process exposed** | Agent mentions fetching skill files, describes its own algorithm, or surfaces internal reasoning steps. |
| **2 — High** | **Rule breaking** | Agent violates its own stated rules or game conditions. |
| **3 — Medium** | **Success rate** | Agent fails to complete games in a notable fraction of sessions. |
| **4 — Low** | **Turn count** | Agent takes significantly more questions than the median to reach a conclusion. |
| **5 — Last** | **Token efficiency** | Agent responses are unnecessarily verbose or repetitive. |

Priorities 3–5 use the median across the log batch as the baseline — there are no fixed numeric thresholds.

---

## GitHub Actions Workflows

### `agent-eval.yml` — Eval on every PR

**Triggers:** Pull request touching `agents/**` or `skills/**`; or manual dispatch.

**Manual dispatch input:** `agent_name` (e.g. `akinator`). Other fields (`min_success_rate`, `max_avg_iterations`, `concurrency`) are optional overrides.

**Required secrets per agent:**

| Secret | Example name | Value |
|---|---|---|
| `N8N_AGENT_<NAME>_WEBHOOK_URL` | `N8N_AGENT_AKINATOR_WEBHOOK_URL` | The n8n webhook URL for the agent's chat endpoint |
| `OPENROUTER_API_KEY` | — | OpenRouter API key (shared across agents) |

The job checks for the agent-specific webhook secret before running. If it is not set, the step prints the exact secret name to add and exits cleanly without failing the PR check.

---

### `generate-eval-set.yml` — Generate eval set for new agents

**Triggers:** Pull request that adds a new `agents/*/system-prompt.md` (detected via `--diff-filter=A`).

**Idempotent:** If `evals/eval-set.json` already exists on the branch, the job skips.

After generation, it commits `eval-set.json` to the PR branch, which then triggers the eval workflow automatically.

**Required secrets:**

| Secret | Description |
|---|---|
| `OPENROUTER_API_KEY` | Used to call the LLM that generates test cases |
| `EVAL_GEN_MODEL` _(optional)_ | OpenRouter model slug. Default: `openai/gpt-5.4-mini` |

---

### `clean-eval-logs.yml` — Delete stale logs after a merge

**Triggers:** Push to `main` touching `agents/**/system-prompt.md` or `skills/**`.

Deletes all files under `agents/<affected>/evals/logs/` for every agent whose prompt or shared skills changed. This resets the session counter so `auto-analyze` fires fresh after the next N runs.

---

### `auto-analyze.yml` — Trigger analysis after N sessions

**Triggers:** Push to `main` touching `agents/*/evals/logs/*.json`.

Counts log files per agent. When the count crosses the threshold (default: 5), calls the `analyze-and-improve` n8n webhook for that agent. Only fires on the crossing — not on every subsequent push above the threshold. The counter resets to zero when `clean-eval-logs` runs after a merge.

**Required secrets / variables:**

| Name | Type | Description |
|---|---|---|
| `N8N_ANALYZE_WEBHOOK_URL` | Secret | Production webhook URL from the `analyze-and-improve` n8n workflow |
| `ANALYZE_SESSIONS_THRESHOLD` | Variable | Minimum sessions before triggering analysis. Default: `5` |

---

## n8n Workflows

Import any workflow: open n8n → workflow canvas → ⋯ menu → Import from file.

### `analyze-and-improve.json`

Reads conversation logs from the repo, identifies failure patterns, and opens a draft PR with targeted edits to the agent's system prompt and skill files.

**Triggers:** Webhook (called by `auto-analyze.yml`) or Execute Sub-Workflow (manual).

**Inputs:**
| Field | Description |
|---|---|
| `owner` / `repo` | GitHub owner and repo name |
| `system_prompt_path` | e.g. `agents/akinator/system-prompt.md` |
| `skills_paths` | Comma-separated list of skill file paths |
| `base_branch` | Target branch for the PR (usually `main`) |
| `github_token` | GitHub token for reading files (write ops use the stored n8n credential) |
| `max_logs` | How many recent logs to analyse (matches `ANALYZE_SESSIONS_THRESHOLD`) |

**What it does:**
1. Fetches system prompt, skill files, and the last `max_logs` conversation logs in parallel
2. LLM analyses failure patterns according to the priority table above
3. Second LLM pass applies targeted edits to each affected file
4. Creates a branch, commits all changes, opens a draft PR

**Credentials to configure after import:**
- All HTTP request nodes → GitHub credential (`AI AGENT VECHAIN`)
- Both LLM nodes → OpenRouter credential (`OpenRouter (Quill)`)

---

### `generate-eval-set.json`

Generates diverse test scenarios for an agent and commits them to `agents/<folder>/evals/eval-set.json`. Run once per agent before the first eval.

**Inputs:** `system_message`, `owner`, `repo`, `agent_folder`, `count` (default 10)

**Each test case:**
```json
{
  "id": 1,
  "chatMessage": "I am ready!",
  "context": "A 28-year-old Italian gamer is thinking of Mario, the Nintendo plumber.",
  "thoughts": "The user loves classic games and wants to test an iconic character."
}
```

`chatMessage` must give the agent zero information. All identifying details live exclusively in `context`. The `thoughts` and `context` fields are never sent to the agent — they are held by the user simulator only.

---

### `edit-system-prompt-pr.json`

AI-edits an agent's system prompt based on free-text instructions and opens a draft PR. Useful for manual one-off improvements outside the automated loop.

**Inputs:** `owner`, `repo`, `system_prompt_path`, `edit_instructions`, `base_branch`

**Output:** `pr_url`, `branch`

---

### `run-single-eval.json`

Runs one complete game simulation for a single test case and returns `{iterations, success, tokens_used}`. Useful for debugging a specific scenario interactively.

---

### `evaluate-pr.json`

The original n8n-based quality gate. Superseded by the TypeScript harness in `agent-eval/` for CI use, but still importable for manual use or local testing without GitHub Actions.

---

## QUALITY_SCORE Header

Every eval run prepends a structured comment to `system-prompt.md`:

```markdown
<!-- QUALITY_SCORE
{
  "model": "deepseek/deepseek-v4-flash",
  "total_games": 10,
  "valid_games": 9,
  "errored_games": 1,
  "successful_games": 7,
  "success_rate": 77.8,
  "avg_iterations": 14.2,
  "total_tokens": 48300,
  "tokens_per_game": 5367,
  "evaluated_at": "2026-01-15T14:30:00.000Z",
  "first_run": false,
  "thresholds_used": null
}
-->
```

The harness strips this header before sending the prompt to the agent, so it never affects game behaviour. A PR is marked ready for review when both `success_rate` and `avg_iterations` strictly improve over the baseline. On the first run, the thresholds from `MIN_SUCCESS_RATE` / `MAX_AVG_ITERATIONS` are used instead.

---

## Required Setup

### GitHub Secrets (Settings → Secrets and variables → Actions)

| Secret | Required | Description |
|---|---|---|
| `N8N_AGENT_<NAME>_WEBHOOK_URL` | Per agent | n8n webhook URL for the agent's chat endpoint. Replace `<NAME>` with the agent folder name uppercased (e.g. `AKINATOR`). |
| `OPENROUTER_API_KEY` | Yes | API key from openrouter.ai |
| `N8N_ANALYZE_WEBHOOK_URL` | Yes | Production webhook URL from `analyze-and-improve.json` in n8n |
| `EVAL_GEN_MODEL` | No | OpenRouter model for eval generation. Default: `openai/gpt-5.4-mini` |

### GitHub Variables (Settings → Secrets and variables → Actions → Variables)

| Variable | Default | Description |
|---|---|---|
| `ANALYZE_SESSIONS_THRESHOLD` | `5` | Number of new eval sessions before auto-analysis fires |

### n8n Credentials

| Credential | Used by | Notes |
|---|---|---|
| GitHub (Personal Access Token, `repo` scope) | All HTTP request nodes | Needs read + write access to this repo |
| OpenRouter API key | All LLM nodes | Same key as `OPENROUTER_API_KEY` secret |
