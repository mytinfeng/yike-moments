<template>
  <Teleport to="body">
    <div v-if="store.loginOpen" class="pyq-mask" @click.self="close">
      <div class="pyq-dialog">
        <div class="pyq-dialog-head">
          <h3>{{ store.user ? '我的账号' : mode === 'login' ? '登录' : '注册' }}</h3>
          <button class="close" @click="close"><i class="ri-close-line"></i></button>
        </div>

        <div class="pyq-dialog-body">
          <!-- 已登录 -->
          <div v-if="store.user">
            <img class="login-avatar-big" :src="store.user.avatar || store.settings.avatar" alt="" />
            <p class="logged-name">{{ store.user.nickname }}</p>
            <p class="logged-email">{{ store.user.email }}</p>
            <div class="logged-links">
              <button @click="go(`/author/${store.user.id}`)"><i class="ri-user-line"></i>我的主页</button>
              <button @click="go('/write')"><i class="ri-camera-line"></i>发布动态</button>
              <button v-if="store.user.role === 'admin'" @click="go('/admin')">
                <i class="ri-settings-3-line"></i>管理后台
              </button>
            </div>
            <button class="btn-primary logout-btn" @click="doLogout">退出登录</button>
          </div>

          <!-- 登录 -->
          <form v-else-if="mode === 'login'" class="login-form" @submit.prevent="doLogin">
            <p class="login-title">欢迎回来</p>
            <div class="form-row">
              <label>账号</label>
              <input v-model="form.username" placeholder="用户名或邮箱" autocomplete="username" />
            </div>
            <div class="form-row">
              <label>密码</label>
              <input
                v-model="form.password"
                type="password"
                placeholder="密码"
                autocomplete="current-password"
              />
            </div>
            <p class="form-error">{{ error }}</p>
            <button class="btn-primary" :disabled="loading || cooldown > 0" type="submit">
              {{ loading ? '登录中…' : cooldown > 0 ? `请 ${cooldown} 秒后重试` : '登录' }}
            </button>
            <p v-if="store.settings.allow_register === '1'" class="login-switch">
              还没有账号？<a @click="switchMode('register')">立即注册</a>
            </p>
          </form>

          <!-- 注册 -->
          <form v-else class="login-form" @submit.prevent="doRegister">
            <p class="login-title">创建账号</p>
            <div class="form-row">
              <label>用户名</label>
              <input v-model="form.username" placeholder="2-16 个字符" autocomplete="username" />
            </div>
            <div class="form-row">
              <label>邮箱</label>
              <input v-model="form.email" type="email" placeholder="邮箱地址" autocomplete="email" />
            </div>
            <div class="form-row">
              <label>密码</label>
              <input
                v-model="form.password"
                type="password"
                placeholder="6-32 位"
                autocomplete="new-password"
              />
            </div>
            <div class="form-row">
              <label>确认密码</label>
              <input
                v-model="form.password2"
                type="password"
                placeholder="再次输入密码"
                autocomplete="new-password"
              />
            </div>
            <p class="form-error">{{ error }}</p>
            <button class="btn-primary" :disabled="loading || cooldown > 0" type="submit">
              {{ loading ? '注册中…' : cooldown > 0 ? `请 ${cooldown} 秒后重试` : '注册并登录' }}
            </button>
            <p class="login-switch">已有账号？<a @click="switchMode('login')">返回登录</a></p>
          </form>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { store, login, register, logout, toast } from '../store.js';

const router = useRouter();
const mode = ref('login');
const loading = ref(false);
const error = ref('');
const cooldown = ref(0);
let cdTimer = null;
const form = reactive({ username: '', password: '', password2: '', email: '' });

/* 被限流时按服务端给的秒数倒计时，期间按钮不可点，避免继续硬撞 */
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

watch(
  () => store.loginOpen,
  (open) => {
    if (open) {
      error.value = '';
      loading.value = false;
    } else {
      clearInterval(cdTimer);
      cdTimer = null;
      cooldown.value = 0;
    }
  }
);

function close() {
  store.loginOpen = false;
}
function switchMode(m) {
  mode.value = m;
  error.value = '';
}
function go(path) {
  close();
  router.push(path);
}

async function doLogin() {
  error.value = '';
  if (cooldown.value > 0) return;
  if (!form.username.trim()) return (error.value = '请输入账号');
  if (!form.password) return (error.value = '请输入密码');
  loading.value = true;
  try {
    const user = await login(form.username.trim(), form.password);
    toast(`欢迎回来，${user.nickname}`);
    form.password = '';
    close();
  } catch (e) {
    error.value = e.message;
    if (e.retryAfter) startCooldown(e.retryAfter);
  } finally {
    loading.value = false;
  }
}

async function doRegister() {
  error.value = '';
  if (!form.username.trim()) return (error.value = '请输入用户名');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) return (error.value = '邮箱格式不正确');
  if (form.password.length < 6) return (error.value = '密码至少 6 位');
  if (form.password !== form.password2) return (error.value = '两次输入的密码不一致');
  loading.value = true;
  try {
    await register({
      username: form.username.trim(),
      email: form.email.trim(),
      password: form.password,
    });
    toast('注册成功，已自动登录');
    close();
  } catch (e) {
    error.value = e.message;
    if (e.retryAfter) startCooldown(e.retryAfter);
  } finally {
    loading.value = false;
  }
}

async function doLogout() {
  await logout();
  toast('已退出登录');
  close();
}
</script>

<style scoped>
.logged-name {
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  color: var(--textqh);
}
.logged-email {
  text-align: center;
  font-size: 12.5px;
  color: var(--texths);
  margin-bottom: 16px;
}
.logged-links {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 18px;
}
.logged-links button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 14px;
  background: var(--backbg);
  border-radius: 8px;
  font-size: 13.5px;
  color: var(--textqh);
  text-align: left;
}
.logged-links button i {
  font-size: 16px;
  color: var(--thetitle);
}
.logout-btn {
  background: #e74c3c;
}
</style>
