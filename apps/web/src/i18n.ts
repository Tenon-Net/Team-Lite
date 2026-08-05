import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

/** Minimal i18n so TeamPage `useTranslation` does not throw. */
void i18n.use(initReactI18next).init({
  lng: 'zh',
  fallbackLng: 'zh',
  resources: {
    zh: {
      translation: {
        'agent.config.failed': '配置失败',
        'agent.config.busy': '配置更新中',
        'agent.config.timeout': '配置超时',
        'agent.config.commandAck': '配置未确认',
        'agent.thoughtLevel.switchSuccess': '思考级别已更新',
      },
    },
  },
  interpolation: { escapeValue: false },
})

export default i18n
