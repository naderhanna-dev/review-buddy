import { test, expect } from '@playwright/test'
import { prWithChecks } from './fixtures/pr-with-checks'

const ORG = 'testorg'
const ORG_ID = 'test-org-id'
const TOKEN = 'test-token'

function seedFreshCache(page: import('@playwright/test').Page, prs: { needsAttention?: unknown[], yourPrs?: unknown[] } = {}) {
  return page.addInitScript(
    ({ token, org, orgId, prData, orgsKey, cacheKey }) => {
      localStorage.setItem(orgsKey, JSON.stringify([{ id: orgId, org, token }]))
      localStorage.setItem(cacheKey, JSON.stringify({
        version: 6,
        entries: {
          [orgId]: {
            timestamp: Date.now(),
            org,
            data: {
              yourPrs: prData.yourPrs ?? [],
              needsAttention: prData.needsAttention ?? [],
              relatedToYou: [],
              stalePrs: [],
              recentlyMerged: [],
              teamSignalsUnavailable: null,
            },
          },
        },
      }))
    },
    {
      token: TOKEN, org: ORG, orgId: ORG_ID,
      prData: prs,
      orgsKey: 'review-radar.orgs',
      cacheKey: 'review-radar.prCache',
    },
  )
}

test('shows rate limit warning with reset time when API returns exhausted quota', async ({ page }) => {
  const resetEpoch = Math.floor(Date.now() / 1000) + 1800

  await page.addInitScript(
    ({ token, org, orgId, pr, orgsKey, cacheKey }) => {
      localStorage.setItem(
        orgsKey,
        JSON.stringify([{ id: orgId, org, token }]),
      )
      const cache = {
        version: 6,
        entries: {
          [orgId]: {
            timestamp: 0,
            org,
            data: {
              yourPrs: [],
              needsAttention: [pr],
              relatedToYou: [],
              stalePrs: [],
              recentlyMerged: [],
              teamSignalsUnavailable: null,
            },
          },
        },
      }
      localStorage.setItem(cacheKey, JSON.stringify(cache))
    },
    {
      token: TOKEN,
      org: ORG,
      orgId: ORG_ID,
      pr: prWithChecks,
      orgsKey: 'review-radar.orgs',
      cacheKey: 'review-radar.prCache',
    },
  )

  await page.route('https://api.github.com/graphql', async (route) => {
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      headers: {
        'x-ratelimit-limit': '5000',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(resetEpoch),
      },
      body: JSON.stringify({ message: 'API rate limit exceeded' }),
    })
  })

  await page.route('https://api.github.com/notifications*', async (route) => {
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      headers: {
        'x-ratelimit-limit': '5000',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(resetEpoch),
      },
      body: JSON.stringify({ message: 'API rate limit exceeded' }),
    })
  })

  await page.goto('/')

  const toast = page.locator('.toast-warning')
  await expect(toast).toBeVisible({ timeout: 10_000 })
  await expect(toast).toContainText('Rate limit hit')
})

test('preserves displayed PRs when rate limited during refresh', async ({ page }) => {
  const resetEpoch = Math.floor(Date.now() / 1000) + 3600
  let callCount = 0

  await seedFreshCache(page, { needsAttention: [prWithChecks] })

  await page.route('https://api.github.com/graphql', async (route) => {
    callCount++
    if (callCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(resetEpoch),
        },
        body: JSON.stringify({
          data: {
            viewer: { login: 'testuser', databaseId: 1, avatarUrl: '', url: '' },
            organization: { teams: { nodes: [] } },
          },
        }),
      })
    } else {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        headers: {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(resetEpoch),
        },
        body: JSON.stringify({ message: 'API rate limit exceeded' }),
      })
    }
  })

  await page.route('https://api.github.com/notifications*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'x-poll-interval': '60' },
      body: JSON.stringify([]),
    })
  })

  await page.goto('/')

  const prRow = page.locator('[data-testid="pr-row"]')
  await expect(prRow.first()).toBeVisible({ timeout: 5_000 })

  await page.waitForTimeout(3000)

  await expect(prRow.first()).toBeVisible()
})

test('PRs stay visible throughout a revalidation fetch cycle', async ({ page }) => {
  await seedFreshCache(page, { needsAttention: [prWithChecks] })

  let resolveGraphql: (() => void) | null = null

  await page.route('https://api.github.com/graphql', async (route) => {
    const body = route.request().postDataJSON() as { query: string }
    if (body.query.includes('PRChecks')) {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: { repository: { pullRequest: { headRefOid: 'abc', headRef: { target: { statusCheckRollup: { contexts: { nodes: [] } } } } } } } }),
      })
      return
    }

    await new Promise<void>((resolve) => { resolveGraphql = resolve })

    await route.fulfill({
      status: 200, contentType: 'application/json',
      headers: {
        'x-ratelimit-limit': '5000',
        'x-ratelimit-remaining': '4999',
        'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
      },
      body: JSON.stringify({
        data: {
          viewer: { login: 'testuser', databaseId: 1, avatarUrl: '', url: '' },
          organization: { teams: { nodes: [] } },
        },
      }),
    })
  })

  await page.route('https://api.github.com/notifications*', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'x-poll-interval': '60' },
      body: JSON.stringify([]),
    })
  })

  await page.goto('/')

  const prRow = page.locator('[data-testid="pr-row"]')
  await expect(prRow.first()).toBeVisible({ timeout: 5_000 })

  await page.waitForTimeout(1000)
  await expect(prRow.first()).toBeVisible()

  resolveGraphql?.()

  await page.waitForTimeout(500)
  await expect(prRow.first()).toBeVisible()
})

test('does not fire additional GraphQL requests after rate limit headers show exhausted quota', async ({ page }) => {
  let graphqlCallCount = 0
  const resetEpoch = Math.floor(Date.now() / 1000) + 3600

  await page.addInitScript(
    ({ token, org, orgId, orgsKey, cacheKey }) => {
      localStorage.setItem(
        orgsKey,
        JSON.stringify([{ id: orgId, org, token }]),
      )
      const cache = {
        version: 6,
        entries: {
          [orgId]: {
            timestamp: 0,
            org,
            data: {
              yourPrs: [],
              needsAttention: [],
              relatedToYou: [],
              stalePrs: [],
              recentlyMerged: [],
              teamSignalsUnavailable: null,
            },
          },
        },
      }
      localStorage.setItem(cacheKey, JSON.stringify(cache))
    },
    {
      token: TOKEN,
      org: ORG,
      orgId: ORG_ID,
      orgsKey: 'review-radar.orgs',
      cacheKey: 'review-radar.prCache',
    },
  )

  await page.route('https://api.github.com/graphql', async (route) => {
    graphqlCallCount++
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'x-ratelimit-limit': '5000',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(resetEpoch),
      },
      body: JSON.stringify({
        data: {
          viewer: { login: 'testuser', databaseId: 1, avatarUrl: '', url: '' },
          organization: { teams: { nodes: [] } },
        },
      }),
    })
  })

  await page.route('https://api.github.com/notifications*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'x-ratelimit-limit': '5000',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(resetEpoch),
        'x-poll-interval': '60',
      },
      body: JSON.stringify([]),
    })
  })

  await page.goto('/')

  await page.waitForTimeout(2000)
  const callsAfterInit = graphqlCallCount

  await page.waitForTimeout(5000)

  expect(graphqlCallCount).toBe(callsAfterInit)
})
