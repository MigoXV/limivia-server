import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import '@fontsource-variable/noto-sans-sc'
import './index.css'
import './workbench.css'
import './peripherals.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
