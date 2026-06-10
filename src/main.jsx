import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import Admin from './admin/Admin.jsx'
import './styles.css'

// Simple path-based split: /admin renders the admin panel, everything else
// renders the funnel page. (Vite's SPA fallback serves index.html for /admin.)
const isAdmin = window.location.pathname.startsWith('/admin')

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>{isAdmin ? <Admin /> : <App />}</React.StrictMode>,
)
