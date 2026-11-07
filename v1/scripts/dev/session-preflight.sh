#!/usr/bin/env bash
# Run at the start of an Arena session, before making local changes.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
branch='arena/0bc0e56e-gradix'
remote="origin/$branch"
if [[ "$(git branch --show-current)" != "$branch" ]]; then
  printf 'Expected branch %s; refusing to change branches.\n' "$branch" >&2
  exit 1
fi
git fetch origin "$branch"
printf 'HEAD:   %s\n' "$(git rev-parse HEAD)"
printf 'remote: %s\n' "$(git rev-parse "$remote")"
printf 'Tracked diff stat:\n'
git diff HEAD --stat
printf 'Untracked files:\n'
git ls-files --others --exclude-standard
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse "$remote")" ]]; then
  if [[ -n "$(git log --format=%H "$remote..HEAD")" ]]; then
    printf 'Local commits found; pushing without force.\n'
    git push origin "$branch"
  else
    git diff HEAD --binary > /tmp/local-before-reset.patch
    printf 'No local commits ahead; tracked diff saved to /tmp/local-before-reset.patch; resetting to remote.\n'
    git reset --hard "$remote"
  fi
fi
printf 'Final HEAD:   %s\n' "$(git rev-parse HEAD)"
printf 'Final remote: %s\n' "$(git rev-parse "$remote")"
printf 'Final status:\n'
git status --short
