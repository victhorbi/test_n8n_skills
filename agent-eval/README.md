# agent-eval

Repo-driven eval harness for the Akinator-style agent. It replaces the n8n workflows
**`1 - Run Eval`** and **`2 - Quality check`** with portable TypeScript that runs in
**GitHub Actions** on pull requests. The agent under test stays in n8n and is called as a
chat webhook, so you can keep iterating on it visually.

## What it does

On a PR that touches `agents/**`:

1. Detect which `agents/<name>` folders changed (matrix — one eval job per agent).
2. Read `<agent_folder>/evals/eval-set.json` and `<agent_folder>/system-prompt.md` from the PR branch.
3. Parse the embedded `QUALITY_SCORE` baseline and strip it to get the clean prompt.
4. Run every eval case as a game: **agent under test** (n8n webhook) ↔ **simulated user** (OpenRouter), looping until the user signals success or `MAX_ITERATIONS` is hit.
5. Aggregate success rate, average iterations, tokens.
6. Decide `improved`:
   - first run: `success_rate ≥ MIN_SUCCESS_RATE` **and** `avg_iterations ≤ MAX_AVG_ITERATIONS`
   - vs baseline: `success_rate >` baseline **and** `avg_iterations <` baseline
7. Commit the updated `QUALITY_SCORE` back onto `system-prompt.md`.
8. If improved **and** there is a PR, mark the PR ready for review.
9. Write a job summary table and a machine-readable `EVAL_RESULT_JSON` line.

## n8n side — what you must wire up

The agent under test is hosted as an n8n chat webhook. eval-core calls it once per turn:

```
POST <N8N_AGENT_WEBHOOK_URL>
Content-Type: application/json
{
  "action": "sendMessage",
  "chatInput":  "<message for the agent>",
  "sessionId":  "<stable per game, unique across games>",
  "systemPrompt": "<candidate prompt under test>",   // optional but recommended
  "ref":        "<PR head branch>"                    // optional but recommended
}
```

Expected response (first match wins): `{ "output" }` | `{ "text" }` | `{ "response" }` |
`{ "data": { "output" } }` | a bare string.

Two things to handle inside the n8n workflow so PR-level testing is meaningful:

- **`sessionId`** — feed it into the agent's memory key so each game's conversation is isolated and turns within a game share memory.
- **`systemPrompt` / `ref`** — the original `1 - Run Eval` fetched `cleanPrompt` but never injected it into the agent, and the agent read skills from `main`. To actually test a PR's prompt/skill changes, the agent must use the `systemPrompt` passed in and fetch skill files from `ref`. If you ignore these fields, the harness still runs but you're testing whatever is on `main`.

## Setup

Repo secrets (Settings → Secrets and variables → Actions):

- `OPENROUTER_API_KEY`
- `N8N_AGENT_WEBHOOK_URL` (e.g. `https://vechain.app.n8n.cloud/webhook/<id>/chat`)

`GITHUB_TOKEN` is provided automatically. The workflow grants it `contents: write`
(commit the score) and `pull-requests: write` (mark ready).

### Pin the actions

`.github/workflows/agent-eval.yml` uses `<PIN_SHA>` placeholders. Replace each with a full
40-char commit SHA before enabling:

```bash
gh api /repos/actions/checkout/git/refs/tags/v4.3.1 --jq '.object.sha'
gh api /repos/actions/setup-node/git/refs/tags/v4.0.3 --jq '.object.sha'
```

Keep the `# action v4` comment so Dependabot can track them.

## Local run

```bash
cp .env.example .env   # fill in the values
set -a && . ./.env && set +a
npm install
npm run eval -- --dry-run        # no commit, no PR change
npm run eval -- --agent-folder agents/akinator --branch some-branch
```

`npm test` runs the pure-logic unit tests (prompt parsing + aggregation).

## Config

CLI flag / env var (CLI wins). See `.env.example` for the full list.

| Flag | Env | Default |
|---|---|---|
| `--agent-folder` | `AGENT_FOLDER` | `agents/akinator` |
| `--branch` | `BRANCH` | (reads `main`) |
| `--pr-number` | `PR_NUMBER` | none |
| `--max-iterations` | `MAX_ITERATIONS` | `40` |
| `--min-success-rate` | `MIN_SUCCESS_RATE` | `50` |
| `--max-avg-iterations` | `MAX_AVG_ITERATIONS` | `30` |
| `--user-model` | `USER_MODEL` | `deepseek/deepseek-v4-flash` |
| `--commit` | `COMMIT` | `true` |
| `--dry-run` | `DRY_RUN` | `false` |
| `--fail-on-regression` | `FAIL_ON_REGRESSION` | `false` |
| `--concurrency` | `CONCURRENCY` | `1` |

## Bugs fixed vs the n8n version

- **Commit path** — the n8n `Commit Quality Report` PUT targeted the agent *folder*
  (`contents/agents/akinator`) instead of the file. Here it writes `system-prompt.md`.
- **`ref` fallback** — `?ref={{ $json.branch || main }}` referenced an undefined
  identifier; reads now fall back to the `main` string.
- **Mark PR ready** — REST `PATCH {draft:false}` does not convert a draft; this uses the
  GraphQL `markPullRequestReadyForReview` mutation.
- **Success edge case** — success now tracks the user actually signalling satisfaction,
  not merely `iterations < max`, fixing the "succeed on the last iteration = loss" corner.

## Caveats

- Fork PRs: `GITHUB_TOKEN` is read-only and secrets are withheld, so eval/commit/ready
  won't run. Intended for same-repo PRs.
- Token accounting currently sums the simulated user's OpenRouter usage. Agent-under-test
  tokens require the n8n webhook to return a `usage` field (not yet wired).
