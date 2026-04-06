import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

new EventSource('http://localhost:3001/api/heartbeat')

createRoot(document.getElementById('root')).render(<App />)
