import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests',
  outputDir: '../../artifacts/playwright',
  use: { baseURL: 'http://127.0.0.1:18000', headless: true },
  webServer: {
    command: 'poetry run limivia-server serve --port 18000',
    cwd: '../..',
    url: 'http://127.0.0.1:18000/api/health',
    reuseExistingServer: false,
  },
})
