import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n' // 引入
import App from './App.vue'
import en from './locales/en.json'
import zh from './locales/zh.json'

const i18n = createI18n({
  legacy: false, // 使用 Composition API 模式
  locale: localStorage.getItem('lang') || 'en', // 默认语言
  fallbackLocale: 'en',
  messages: { en, zh }
})

const app = createApp(App)
app.use(createPinia())
app.use(i18n) // 挂载
app.mount('#app')
