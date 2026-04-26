import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Side-effect import: registers window.posStressTest so an operator can drive
// the POS print pipeline from DevTools (smoke / idempotent / burst / failure).
// The module has no top-level work besides assigning the global, so the
// bundle cost is tiny and there's no production-time impact.
import './devtools/posStressTest'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Use contextBridge
window.ipcRenderer.on('main-process-message', (_event, message) => {
  console.log(message)
})
