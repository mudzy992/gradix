import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')

test('main and release branches do not cancel an in-progress CI run', () => {
  assert.match(workflow, /cancel-in-progress: \$\{\{ startsWith\(github\.ref, 'refs\/heads\/'\) && github\.ref != 'refs\/heads\/main' && !startsWith\(github\.ref, 'refs\/heads\/release'\) \}\}/)
})

test('web E2E caches the exact installed Playwright version and runner image', () => {
  const web = workflow.split('  web-e2e:')[1].split('  # ---------------------------------------------------------------------------')[0]
  assert.match(web, /require\(['"]@playwright\/test\/package\.json['"]\)\.version/)
  assert.match(web, /uses: actions\/cache@0057852bfaa89a56745cba8c7296529d2fc39830/)
  assert.match(web, /path: ~\/\.cache\/ms-playwright/)
  assert.match(web, /key: playwright-\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-\$\{\{ steps\.playwright-version\.outputs\.image \}\}-\$\{\{ steps\.playwright-version\.outputs\.version \}\}/)
  assert.doesNotMatch(web, /restore-keys:/)
  assert.ok(web.indexOf('npm ci --no-audit --no-fund', web.indexOf('Frontend — build')) < web.indexOf('id: playwright-version'))
  assert.ok(web.indexOf('id: playwright-version') < web.indexOf('uses: actions/cache@'))
  assert.ok(web.indexOf('uses: actions/cache@') < web.indexOf('npx playwright install --with-deps chromium'))
})
