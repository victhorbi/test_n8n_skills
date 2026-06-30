import type { GithubCreds } from "./types.js";

const API = "https://api.github.com";

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "agent-eval",
  };
}

async function ghFetch(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeaders(token), ...(init.headers as Record<string, string> | undefined) },
  });
  return res;
}

export function decodeBase64(b64: string): string {
  return Buffer.from(b64.replace(/\n/g, ""), "base64").toString("utf8");
}

export function encodeBase64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

export interface FileContent {
  decoded: string;
  sha: string;
  path: string;
}

/** GET /repos/{owner}/{repo}/contents/{path}?ref=… */
export async function getContent(
  cfg: GithubCreds,
  path: string,
  ref: string | null,
): Promise<FileContent> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const url = `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}${q}`;
  const res = await ghFetch(cfg.githubToken, url);
  if (!res.ok) {
    throw new Error(`getContent ${path} failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { content: string; sha: string; path: string };
  return { decoded: decodeBase64(data.content), sha: data.sha, path: data.path };
}

/**
 * PUT /repos/{owner}/{repo}/contents/{path}
 * NOTE: path must be the FILE path (e.g. agents/akinator/system-prompt.md),
 * not the agent folder. (The original n8n flow PUT to the folder — that was a bug.)
 */
export async function putContent(
  cfg: GithubCreds,
  opts: { path: string; content: string; message: string; branch: string | null; sha?: string },
): Promise<void> {
  const url = `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${opts.path}`;
  const body: Record<string, unknown> = {
    message: opts.message,
    content: encodeBase64(opts.content),
  };
  if (opts.sha) body.sha = opts.sha; // omit sha for new files
  if (opts.branch) body.branch = opts.branch; // omit -> default branch
  const res = await ghFetch(cfg.githubToken, url, { method: "PUT", body: JSON.stringify(body) });
  if (!res.ok) {
    throw new Error(`putContent ${opts.path} failed: ${res.status} ${await res.text()}`);
  }
}

/** Return the GraphQL node_id for a pull request (needed for the ready-for-review mutation). */
export async function getPullRequestNodeId(cfg: GithubCreds, prNumber: number): Promise<string> {
  const url = `${API}/repos/${cfg.owner}/${cfg.repo}/pulls/${prNumber}`;
  const res = await ghFetch(cfg.githubToken, url);
  if (!res.ok) {
    throw new Error(`getPullRequest ${prNumber} failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { node_id: string };
  return data.node_id;
}

/**
 * Convert a draft PR to "ready for review".
 * This is GraphQL-only — the REST update-PR endpoint does NOT accept a `draft` field,
 * which is why the original n8n PATCH {draft:false} was a silent no-op.
 */
export async function markPullRequestReady(cfg: GithubCreds, prNumber: number): Promise<void> {
  const nodeId = await getPullRequestNodeId(cfg, prNumber);
  const query = `mutation($id: ID!) {
    markPullRequestReadyForReview(input: { pullRequestId: $id }) {
      pullRequest { isDraft number }
    }
  }`;
  const res = await ghFetch(cfg.githubToken, `${API}/graphql`, {
    method: "POST",
    body: JSON.stringify({ query, variables: { id: nodeId } }),
  });
  const json = (await res.json()) as { errors?: unknown };
  if (!res.ok || json.errors) {
    throw new Error(`markPullRequestReady failed: ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  }
}
