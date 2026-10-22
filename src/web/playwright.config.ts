import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests',
  outputDir: '../../artifacts/playwright',
  use: { baseURL: 'http://127.0.0.1:8000', headless: true },
  webServer: {
    command: 'poetry run limivia-server serve',
    cwd: '../..',
    url: 'http://127.0.0.1:8000/api/health',
    reuseExistingServer: true,
  },
})
