import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { api, HttpTransport } from './services/api'
import { useAuthStore } from './stores/auth'
import './style.css'

async function bootstrap() {
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)

  const auth = useAuthStore()

  let transport
  // The literal comparison lets the bundler drop the mock runtime (and the backend source it embeds)
  // from production builds entirely; API_MODE above is for display only.
  if (import.meta.env.VITE_API_MODE === 'mock') {
    const { MockTransport } = await import('./services/mockTransport')
    transport = new MockTransport()
  } else {
    const baseUrl = import.meta.env.VITE_API_BASE_URL || ''
    transport = new HttpTransport(baseUrl)
  }

  api.configure({
    transport,
    tokenProvider: () => auth.token,
    onUnauthenticated: () => {
      auth.clear()
      if (router.currentRoute.value.name !== 'login') router.push({ name: 'login', query: { reason: 'expired' } })
    },
  })

  app.use(router)
  app.mount('#app')
}

bootstrap()
