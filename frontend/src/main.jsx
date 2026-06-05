import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
// OpenDyslexic, self-hosted so it works offline (a body-font option in Settings).
import '@fontsource/opendyslexic/400.css'
import '@fontsource/opendyslexic/700.css'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
