import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import Admin from './admin/Admin.jsx'
import PaymentSuccess from './components/PaymentSuccess.jsx'
import './styles.css'

// Simple path-based split: /admin → admin panel, /payment-success → the
// Razorpay redirect landing, everything else → the funnel page. (Vite's SPA
// fallback serves index.html for these paths.)
const path = window.location.pathname
const route = path.startsWith('/admin')
  ? <Admin />
  : path.startsWith('/payment-success')
    ? <PaymentSuccess />
    : <App />

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>{route}</React.StrictMode>,
)
