import { defineConfig } from '@playwright/test'

const port = process.env.PW_PORT ?? '5199'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: `http://localhost:${port}` },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `pnpm exec vite --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
  },
})
