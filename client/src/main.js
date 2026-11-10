import { createApp } from 'vue';
import App from './App.vue';
import router from './router.js';
import { bootstrap } from './store.js';
import lazy from './directives/lazy.js';

import 'remixicon/fonts/remixicon.css';
import './styles/main.css';
import './styles/admin.css';

bootstrap().finally(() => {
  createApp(App).use(router).directive('lazy', lazy).mount('#app');
});

/* PWA：只在生产构建里注册。开发模式注册会把 vite 热更新搅乱 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
