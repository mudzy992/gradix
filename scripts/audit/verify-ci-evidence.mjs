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

export async function githubRequest(path) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN je obavezan za online CI provjeru');
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gradix-audit-gate' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`GitHub API status ${response.status}`);
  return response.json();
}
