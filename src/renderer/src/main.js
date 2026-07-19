import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n' // 引入
import App from './App.vue'
import { router } from './app/router'
import './assets/main.css'
import en from './locales/en.json'
import zh from './locales/zh.json'
import ja from './locales/ja.json'

const i18n = createI18n({
  legacy: false, // 使用 Composition API 模式
  locale: localStorage.getItem('lang') || 'en', // 默认语言
  fallbackLocale: 'en',
  messages: { en, zh, ja }
})

const app = createApp(App)
app.use(createPinia())
app.use(i18n) // 挂载
app.use(router)
document.documentElement.dataset.window = new URLSearchParams(window.location.search).get('mode') === 'overlay' ? 'overlay' : 'main'
app.mount('#app')
