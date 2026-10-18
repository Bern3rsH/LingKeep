import { createRoot } from 'react-dom/client'
import { App } from './App'
import { flushDrafts } from './api'
import './styles.css'
window.ling.onCloseRequested(flushDrafts)
createRoot(document.getElementById('root')!).render(<App />)
