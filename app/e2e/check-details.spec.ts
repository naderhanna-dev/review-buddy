import { test, expect } from '@playwright/test'
import { prWithChecks } from './fixtures/pr-with-checks'

const ORG = 'testorg'
const TOKEN = 'test-token'

test.beforeEach(async ({ page }) => {
  // Inject localStorage before page scripts run so the app starts with mock data.
  // Date.now() is called inside the browser context so the timestamp is always fresh,
  // ensuring the cache is within the 5-minute revalidation TTL and no API calls are made.
  await page.addInitScript(
    ({ token, org, pr, tokenKey, orgKey, cacheKey }) => {
      localStorage.setItem(tokenKey, token)
      localStorage.setItem(orgKey, org)
      const cache = {
        version: 5,
        timestamp: Date.now(),
        org,
        data: {
          yourPrs: [],
          needsAttention: [pr],
          relatedToYou: [],
          stalePrs: [],
          recentlyMerged: [],
          teamSignalsUnavailable: null,
        },
      }
      localStorage.setItem(cacheKey, JSON.stringify(cache))
    },
    {
      token: TOKEN,
      org: ORG,
      pr: prWithChecks,
      tokenKey: 'review-radar.pat',
      orgKey: 'review-radar.org',
      cacheKey: 'review-radar.prCache',
    },
  )

  // Mock the GitHub GraphQL endpoint.
  // PRChecks query (lazy-loaded on row expand) returns mock check data.
  // All other queries (batch revalidation) return a minimal viewer/org response.
  await page.route('https://api.github.com/graphql', async (route) => {
    const body = route.request().postDataJSON() as { query: string }
    if (body.query.includes('PRChecks')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                commits: {
                  nodes: [{
                    commit: {
                      statusCheckRollup: {
                        contexts: {
                          nodes: [
                            { __typename: 'CheckRun', name: 'build / lint', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://example.com/1' },
                            { __typename: 'CheckRun', name: 'build / test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://example.com/2' },
                            { __typename: 'CheckRun', name: 'deploy / preview', status: 'IN_PROGRESS', conclusion: null, detailsUrl: null },
                          ],
                        },
                      },
                    },
                  }],
                },
              },
            },
          },
        }),
      })
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            viewer: { login: 'testuser', databaseId: 1, avatarUrl: '', url: '' },
            organization: { teams: { nodes: [] } },
          },
        }),
      })
    }
  })

  await page.goto('/')
})

test('clicking a pr-row opens the check-details-panel', async ({ page }) => {
  const prRow = page.locator('[data-testid="pr-row"]').first()
  await expect(prRow).toBeVisible()
  await prRow.click()
  await expect(page.locator('[data-testid="check-details-panel"]')).toBeVisible()
})

test('clicking the pr-row again closes the panel', async ({ page }) => {
  const prRow = page.locator('[data-testid="pr-row"]').first()
  await expect(prRow).toBeVisible()
  await prRow.click()
  await expect(page.locator('[data-testid="check-details-panel"]')).toBeVisible()
  await prRow.click()
  await expect(page.locator('[data-testid="check-details-panel"]')).not.toBeVisible()
})

test('clicking pr-title-link does NOT open the panel', async ({ page }) => {
  const titleLink = page.locator('[data-testid="pr-title-link"]').first()
  await expect(titleLink).toBeVisible()
  // The link has target="_blank" so the main page stays on localhost:5173
  await titleLink.click()
  await expect(page.locator('[data-testid="check-details-panel"]')).not.toBeVisible()
})

test('check-item elements show the correct check names from the mock data', async ({ page }) => {
  const prRow = page.locator('[data-testid="pr-row"]').first()
  await expect(prRow).toBeVisible()
  await prRow.click()
  await expect(page.locator('[data-testid="check-details-panel"]')).toBeVisible()

  const checkItems = page.locator('[data-testid="check-item"]')
  await expect(checkItems).toHaveCount(3)
  await expect(page.locator('[data-testid="check-item-name"]').nth(0)).toHaveText('build / lint')
  await expect(page.locator('[data-testid="check-item-name"]').nth(1)).toHaveText('build / test')
  await expect(page.locator('[data-testid="check-item-name"]').nth(2)).toHaveText('deploy / preview')
})
