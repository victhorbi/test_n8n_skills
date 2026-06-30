# Self-Improving AI Agent System

## What it is
A continuous improvement loop for AI conversational agents. An engineer writes
an initial agent definition; the system evaluates it automatically on every
proposed change, scores performance, and periodically proposes its own
improvements — without manual tuning.

## Actors
| Actor | Role |
|---|---|
| Developer | Authors agent definitions, skills, and reviews pull requests |
| GitHub | Stores all versioned content and triggers automation on changes |
| CI Pipeline | Detects what changed and runs the evaluation harness |
| Evaluation Harness | Orchestrates simulated conversations and computes quality scores |
| Agent Under Test | The AI conversational agent being evaluated (externally hosted) |
| User Simulator | An LLM that plays a realistic end-user in each conversation |
| Analysis Workflow | Reads accumulated logs, identifies failure patterns, proposes fixes |

---

## Flow

### Phase 1 — Setup (one-time)
1. Developer writes an **agent definition**: goal, persona, and constraints.
2. Developer writes **shared skills**: reusable knowledge modules the agent references.
3. An AI workflow generates an **evaluation scenario set**: a battery of realistic
   simulated conversations designed to test the agent's abilities.

---

### Phase 2 — Pull Request Loop (repeats on every change)

**A. Open a pull request**
A developer (or the Analysis Workflow — see Phase 3) proposes a change to the
agent definition, the skills, or both.

**B. Detect scope**
The CI pipeline inspects what changed:
- Changes to an agent definition → evaluate that agent only
- Changes to shared skills → re-evaluate all agents

**C. Evaluate**
The Evaluation Harness runs all scenarios in parallel:
- Each scenario: User Simulator sends a message → Agent responds → repeat until
  the goal is reached or the turn limit is hit.
- At least 80% of scenarios must complete without error; if not, the run fails.

**D. Score**
The harness computes a quality score: success rate, average turns-to-goal,
token efficiency. The score is written back into the pull request.
A full conversation log is saved to the repository for later analysis.

**E. Gate**
- Score improved vs. baseline → pull request promoted from draft to "ready for review"
- Score did not improve → pull request stays as a draft; developer iterates

**F. Merge**
Developer reviews the ready pull request and merges it.
The new agent definition becomes the new baseline.

---

### Phase 3 — Analysis Loop (periodic, manually triggered)

Once several improvement cycles have accumulated logs:

1. Developer triggers the **Analysis Workflow** manually.
2. The workflow reads the current agent definition, skills, and the last N conversation logs.
3. An LLM **analyzes failure patterns**: recurring misunderstandings, skill gaps,
   scenarios the agent consistently struggled with.
4. A second LLM pass **applies targeted improvements** to each affected file.
5. The workflow opens a new draft pull request — re-entering Phase 2 automatically.

---

## Key properties
- Evaluation is fully automated; no human grading required.
- The quality score is the only gate between a draft and human review.
- Shared skill changes propagate to all agents immediately.
- Conversation logs accumulate on the main branch, fueling future analysis.
- The loop is self-reinforcing: more runs → richer logs → better analysis → better agent.
