<template>
  <div class="admin-root">
    <div class="admin-login">
      <div class="login-card">
        <div class="brand">
          <div class="dot"><i class="ri-quill-pen-fill"></i></div>
        </div>
        <h2>朋友圈管理后台</h2>
        <p class="tip">请使用管理员账号登录</p>

        <form @submit.prevent="submit">
          <div class="a-field">
            <label>账号</label>
            <input v-model="username" class="a-input" placeholder="用户名或邮箱" autocomplete="username" />
          </div>
          <div class="a-field">
            <label>密码</label>
            <input
              v-model="password"
              class="a-input"
              type="password"
              placeholder="密码"
              autocomplete="current-password"
            />
          </div>
          <p class="login-err">{{ error }}</p>
          <button
            class="a-btn primary"
            style="width: 100%; justify-content: center; height: 42px"
            :disabled="loading || cooldown > 0"
          >
            {{ loading ? '登录中…' : cooldown > 0 ? `请 ${cooldown} 秒后重试` : '登录' }}
          </button>
        </form>

        <p class="login-foot">
          <a href="/"><i class="ri-arrow-left-line"></i> 返回前台</a>
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { login, toast } from '../../store.js';

const router = useRouter();
const route = useRoute();
const username = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);
const cooldown = ref(0);
let cdTimer = null;

function startCooldown(sec) {
  clearInterval(cdTimer);
  cooldown.value = Math.max(1, Math.ceil(Number(sec) || 0));
  cdTimer = setInterval(() => {
    cooldown.value -= 1;
    if (cooldown.value <= 0) {
      clearInterval(cdTimer);
      cdTimer = null;
      cooldown.value = 0;
    }
  }, 1000);
}

onBeforeUnmount(() => clearInterval(cdTimer));

async function submit() {
  error.value = '';
  if (cooldown.value > 0) return;
  if (!username.value.trim() || !password.value) {
    error.value = '请输入账号和密码';
    return;
  }
  loading.value = true;
  try {
    const user = await login(username.value.trim(), password.value);
    if (user.role !== 'admin') {
      error.value = '该账号不是管理员';
      return;
    }
    toast('登录成功');
    router.replace(route.query.redirect || '/admin');
  } catch (e) {
    error.value = e.message;
    if (e.retryAfter) startCooldown(e.retryAfter);
  } finally {
    loading.value = false;
  }
}
</script>
