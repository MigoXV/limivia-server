import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests',
  workers: 1,
  outputDir: '../../artifacts/playwright',
  use: { baseURL: 'http://127.0.0.1:18000', headless: true },
  webServer: {
    command: 'poetry run python -m tests.e2e_server',
    cwd: '../..',
    url: 'http://127.0.0.1:18000/api/health',
    reuseExistingServer: false,
  },
})
