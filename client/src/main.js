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
