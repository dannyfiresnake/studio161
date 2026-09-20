import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'

// This is a kiosk-style control surface, not a document: the webview's
// default context menu (reload / back / inspect) has nothing useful on it
// and it fires on touch press-and-hold, interrupting the fader drags.
// Capture phase, so it applies even where a handler stops propagation.
window.addEventListener('contextmenu', (e) => e.preventDefault(), { capture: true })

createApp(App).mount('#app')
