import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
// Fonts are self-hosted via @fontsource, so the app renders in-brand offline and
// makes no third-party (Google Fonts) request - one less GDPR question. Weights
// mirror what the old CDN <link> requested. Geist Sans ships latin-only upstream.
import '@fontsource/geist-sans/latin-300.css'
import '@fontsource/geist-sans/latin-400.css'
import '@fontsource/geist-sans/latin-500.css'
import '@fontsource/geist-sans/latin-600.css'
import '@fontsource/geist-sans/latin-700.css'
import '@fontsource/geist-mono/latin-400.css'
import '@fontsource/geist-mono/latin-500.css'
import '@fontsource/lexend/latin-300.css'
import '@fontsource/lexend/latin-400.css'
import '@fontsource/lexend/latin-500.css'
import '@fontsource/lexend/latin-600.css'
// OpenDyslexic, a dyslexia-friendly body-font option in Settings.
import '@fontsource/opendyslexic/400.css'
import '@fontsource/opendyslexic/700.css'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
