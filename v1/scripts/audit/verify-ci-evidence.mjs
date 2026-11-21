// GitHub API verification is separate from the offline inventory gate.
// request is injectable so the failure modes can be tested without network access.
const REQUIRED_JOBS = [
  'Audit (guardrail + matrica pokrivenosti)',
  'Backend (lint + unit + build)',
  'Backend (e2e)',
  'Frontend (lint + typecheck + test + build)',
  'Web E2E (Playwright)',
  'Docker build (Coolify gate)',
];

export async function verifyRun(repo, id, request) {
  const base = `/repos/${repo}/actions/runs/${id}`;
  const run = await request(base);
  if (run.path !== '.github/workflows/ci.yml' || run.status !== 'completed' || run.conclusion !== 'success') {
    throw new Error(`run ${id}: nije završen uspješan CI workflow`);
  }
  const result = await request(`${base}/jobs?per_page=100`);
  if (result.total_count !== REQUIRED_JOBS.length || !Array.isArray(result.jobs) || result.jobs.length !== REQUIRED_JOBS.length ||
      REQUIRED_JOBS.some((name) => result.jobs.filter((job) => job.name === name && job.conclusion === 'success').length !== 1)) {
    throw new Error(`run ${id}: nije prošlo svih šest CI poslova`);
  }
}

export class CiVerificationUnavailable extends Error {}

export async function verifyEvidenceBatch(entries, request) {
  const errors = [];
  const warnings = [];
  for (const evidence of entries) {
    const [repo, id] = evidence.split('#');
    try { await verifyRun(repo, id, request); }
    catch (e) {
      const message = `CI dokaz ${repo}#${id}: ${e.message}`;
      if (e instanceof CiVerificationUnavailable) warnings.push(`${message}; online provjera preskočena, tvrdnja nije potvrđena`);
      else errors.push(message);
    }
  }
  return { errors, warnings };
}

export async function githubRequest(path, fetchImpl = fetch) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new CiVerificationUnavailable('GITHUB_TOKEN nije dostupan');
  let response;
  try {
    response = await fetchImpl(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gradix-audit-gate' },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new CiVerificationUnavailable('mreža ili GitHub API nisu dostupni');
  }
  if ([401, 403, 429].includes(response.status) || response.status >= 500) {
    throw new CiVerificationUnavailable(`GitHub API status ${response.status}`);
  }
  if (!response.ok) throw new Error(`GitHub API status ${response.status}`);
  return response.json();
}
