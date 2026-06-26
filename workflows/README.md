# Workflows

Five importable n8n workflows that together form a self-improving Akinator agent pipeline.

**Import any workflow:** open n8n → any workflow canvas → ⋯ menu → Import from file → select the JSON.

---

## Overview

```
User chat
    │
    ▼
akinator-game ──────────────────────────────────── live game (chat UI)
    
Human edits system-prompt.md  ─OR─  edit-system-prompt-pr
    │                                       │
    │                               opens draft PR on a new branch
    │                                       │
    └───────────────────────────────────────┘
                                            │
                                      evaluate-pr
                                (triggered manually or wired at the end
                                 of edit-system-prompt-pr)
                                            │
                           ┌────────────────┴────────────────┐
                           │  run-single-eval (×N test cases) │
                           │  (called inline via Code node)   │
                           └──────────────────────────────────┘
                                            │
                              quality score prepended to prompt
                              PR marked ready if both metrics improved
```

The first time you use evals, run **generate-eval-set** once to populate `agents/akinator/evals/eval-set.json`.

---

## 1. `akinator-game.json` — Main Chat Agent

The live Akinator agent. Connect it to any chat interface.

**Trigger:** Chat message (n8n Chat or webhook)

**What it does:**
1. On every incoming message, fetches the directory listing of `victhorbi/test_n8n_skills`
2. Injects the listing into the system prompt so the agent knows which skill files exist
3. The agent fetches skill files on demand using `Get a File From GitHub`
4. Plays the Akinator game following the skill instructions

**Nodes to configure after import:**
| Node | Field | Action |
|------|-------|--------|
| `Set GitHub Repo URLs` | `SKILLS_REPOS` value | Update if you fork the repo |
| `Chat Model` | credential | Select your OpenRouter credential |
| `List Root Dirs` / `List Skills Dirs` / `List Files by Path Name` / `Get a File From GitHub` | credential | Select your GitHub credential |

**To add more skill repos,** extend the array in `Set GitHub Repo URLs`:
```json
["https://github.com/victhorbi/test_n8n_skills", "https://github.com/you/more-skills"]
```

---

## 2. `edit-system-prompt-pr.json` — Edit Prompt + Open PR

A sub-workflow that edits an agent's system prompt with AI and opens a draft PR.

**Trigger:** Execute Sub-Workflow (call from another workflow or manually via n8n Test)

**Inputs:**
| Field | Type | Example |
|-------|------|---------|
| `owner` | string | `victhorbi` |
| `repo` | string | `test_n8n_skills` |
| `system_prompt_path` | string | `agents/akinator/system-prompt.md` |
| `edit_instructions` | string | `Add a rule that the agent must always ask about gender before nationality` |
| `base_branch` | string | `main` |

**Outputs:**
| Field | Description |
|-------|-------------|
| `pr_url` | URL of the opened draft PR |
| `branch` | Name of the created branch (e.g. `chore/edit-system-prompt-20250115-143022`) |

**What it does:**
1. Fetches the current file from GitHub (including its SHA for the update commit)
2. Sends the current prompt + edit instructions to an LLM — returns only the updated prompt text
3. Creates a new branch, commits the edited file, opens a draft PR
4. Returns `{pr_url, branch}`

**Wiring tip:** Add an `Execute Sub-Workflow` node at the end pointing to `evaluate-pr`, passing `{owner, repo, branch, pr_number}` from this workflow's output. The PR number is in the `Open Draft PR` node response as `$json.number`.

**Nodes to configure after import:**
| Node | Field | Action |
|------|-------|--------|
| `Edit Prompt` → `LLM Model` | credential | Select your OpenRouter credential |
| All HTTP nodes | credential | Select your GitHub credential |

---

## 3. `generate-eval-set.json` — Generate Evaluation Test Cases

Generates a diverse set of test cases for evaluating the Akinator agent and commits them to the repo.

**Trigger:** Execute Sub-Workflow or manual Test run

**Inputs:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `system_message` | string | — | The agent's current system prompt (used to tailor the eval cases) |
| `owner` | string | — | GitHub owner |
| `repo` | string | — | GitHub repo name |
| `agent_folder` | string | — | Subfolder under `agents/` (e.g. `akinator`) |
| `count` | number | `50` | Number of test cases to generate (20–100 recommended) |

**Outputs:**
| Field | Description |
|-------|-------------|
| `path` | Path of the committed file |
| `count` | Number of valid test cases written |
| `file_url` | GitHub URL of the committed file |

**What it does:**
1. Sends the system prompt to an LLM asking it to generate `count` diverse test cases
2. Each test case has: `id`, `chatMessage`, `context`, `thoughts`
3. Validates and deduplicates by first 60 chars of `context`
4. Commits the JSON array to `agents/{agent_folder}/evals/eval-set.json`
   - If the file already exists it updates it (uses the file's SHA); otherwise creates it

**Test case schema:**
```json
{
  "id": 1,
  "chatMessage": "I am ready to play!",
  "context": "A 28-year-old Italian gamer is secretly thinking of Mario, the fictional Nintendo plumber in red overalls who rescues Princess Peach.",
  "thoughts": "The user grew up playing Super Mario Bros and wants to see if the agent can narrow down a well-known video game character."
}
```

`chatMessage` must be a completely neutral opener that gives the agent zero information. The character name and all identifying details live exclusively in `context`. `thoughts` captures the user's motivation, not character traits.

**Run this once** before using `evaluate-pr` for the first time.

**Nodes to configure after import:**
| Node | Field | Action |
|------|-------|--------|
| `LLM Model` | credential | Select your OpenRouter credential |
| `GET Existing File SHA` / `Commit Eval Set` | credential | Select your GitHub credential |

---

## 4. `run-single-eval.json` — Run One Game Simulation

Simulates a complete Akinator game for a single test case and returns performance stats. Can be called in a loop by `evaluate-pr`.

**Trigger:** Execute Sub-Workflow

**Inputs:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `chatMessage` | string | — | User's neutral opening message (zero information) |
| `context` | string | — | Narrative embedding the character name and user scenario (simulator source of truth) |
| `thoughts` | string | — | User's internal motivation/mindset going into the game |
| `branch` | string | — | Branch to fetch the system prompt from |
| `owner` | string | — | GitHub owner |
| `repo` | string | — | GitHub repo name |
| `max_iterations` | number | `40` | Max questions before the game ends |

**Outputs:**
```json
{ "iterations": 12, "success": true, "model": "google/gemini-2.5-flash-preview", "tokens_used": 48300 }
```

**What it does:**
1. Fetches the system prompt from the specified branch (so it evaluates the exact version being tested)
2. Runs a full game simulation loop:
   - **Akinator turn:** calls the LLM with the system prompt + conversation history
   - **User turn:** a second LLM call simulates the user answering based on `context` and `thoughts`
   - Detects guesses via regex; stops on a confirmed correct guess
3. Returns total iterations, success flag, model used, and total tokens consumed

**Environment variables required** (n8n Settings → Variables):
| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | Your OpenRouter API key |
| `EVAL_MODEL` (optional) | Model to use for simulation. Default: `google/gemini-2.5-flash-preview` |

**Nodes to configure after import:**
| Node | Field | Action |
|------|-------|--------|
| `Fetch System Prompt` | credential | Select your GitHub credential |

---

## 5. `evaluate-pr.json` — Quality Gate for Open PRs

Runs the full eval suite against the system prompt on a PR branch, prepends a quality score to the file, and marks the PR ready for review if quality improved.

**Trigger:** Execute Sub-Workflow (wire at the end of `edit-system-prompt-pr`) or manual Test run

**Inputs:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `owner` | string | — | GitHub owner |
| `repo` | string | — | GitHub repo name |
| `branch` | string | — | Branch to evaluate (the PR branch) |
| `pr_number` | number | — | PR number (from `Open Draft PR` node response) |
| `system_prompt_path` | string | `agents/akinator/system-prompt.md` | Path to the system prompt file |
| `max_iterations` | number | `40` | Per-game iteration limit |
| `min_success_rate` | number | `50` | Floor threshold used on first run (no baseline yet) |
| `max_avg_iterations` | number | `30` | Ceiling threshold used on first run (no baseline yet) |

**Outputs:**
```json
{
  "quality_score": {
    "model": "google/gemini-2.5-flash-preview",
    "total_games": 50,
    "successful_games": 41,
    "success_rate": 82.0,
    "avg_iterations": 11.4,
    "total_tokens": 2415000,
    "tokens_per_game": 48300,
    "evaluated_at": "2025-01-15T14:30:00.000Z",
    "first_run": false,
    "thresholds_used": null
  },
  "improved": true,
  "first_run": false,
  "pr_ready": true,
  "pr_url": "https://github.com/victhorbi/test_n8n_skills/pull/3"
}
```

**What it does:**
1. Fetches the eval set and system prompt from the PR branch in parallel
2. Strips any existing quality header from the prompt so it doesn't affect game behavior
3. Runs every eval case through the full game simulation loop (same logic as `run-single-eval`)
4. Computes aggregate stats: `success_rate`, `avg_iterations`, `tokens_per_game`
5. Compares to the baseline — with two different paths depending on whether a prior score exists:
6. Prepends the new quality score block to the system prompt:
   ```
   <!-- QUALITY_SCORE
   { "model": "...", "success_rate": 82.0, "avg_iterations": 11.4, "first_run": false, ... }
   -->

   You are an Akinator-style game agent...
   ```
7. Commits the updated prompt to the PR branch
8. If `improved = true` → removes draft status from the PR

**Quality improvement logic — two cases:**

*No prior score (first run — `first_run: true`):*
```
improved = (success_rate >= min_success_rate)   ← default 50%
        AND (avg_iterations <= max_avg_iterations)  ← default 30
```
The thresholds used are recorded in the header under `thresholds_used` so you can see what bar was applied.

*Subsequent runs (baseline exists — `first_run: false`):*
```
improved = (new_success_rate > baseline_success_rate)
        AND (new_avg_iterations < baseline_avg_iterations)
```
Both metrics must strictly improve. A regression on either keeps the PR as draft.

**Environment variables required** (same as `run-single-eval`):
| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | Your OpenRouter API key |
| `EVAL_MODEL` (optional) | Model to use for simulation |

**Nodes to configure after import:**
| Node | Field | Action |
|------|-------|--------|
| `Fetch Eval Set` / `Fetch System Prompt` / `Commit Quality Report` / `Mark PR Ready` | credential | Select your GitHub credential |

---

## End-to-End Self-Improvement Loop

```
1. Import all 5 workflows into n8n

2. Run generate-eval-set once:
   Input: { system_message: <contents of agents/akinator/system-prompt.md>,
            owner: "victhorbi", repo: "test_n8n_skills",
            agent_folder: "akinator", count: 50 }

3. Trigger edit-system-prompt-pr with an improvement idea:
   Input: { owner: "victhorbi", repo: "test_n8n_skills",
            system_prompt_path: "agents/akinator/system-prompt.md",
            edit_instructions: "Make the agent ask about gender first",
            base_branch: "main" }
   → A draft PR is opened on a new branch

4. Wire evaluate-pr at the end of edit-system-prompt-pr:
   Pass { owner, repo, branch, pr_number } from the PR creation response
   → All 50 test cases run against the edited prompt
   → Quality score is committed to the PR branch
   → PR is marked ready if both metrics improved

5. Review and merge the PR in GitHub
   (or let it auto-close if quality regressed)
```
