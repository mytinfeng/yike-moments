<template>
  <div style="display: flex; flex-direction: column; gap: 16px; max-width: 720px">
    <div class="card">
      <div class="card-head"><h3>个人资料</h3></div>
      <div class="card-body a-form">
        <div class="a-field">
          <label>头像</label>
          <div class="upload-thumbs">
            <div class="upload-preview">
              <img :src="form.avatar || store.settings.avatar" alt="" />
            </div>
            <div class="upload-box" @click="avatarInput?.click()"><i class="ri-image-add-line"></i>更换头像</div>
          </div>
        </div>
        <div class="a-row">
          <div class="a-field">
            <label>昵称</label>
            <input v-model="form.nickname" class="a-input" maxlength="16" />
          </div>
          <div class="a-field">
            <label>邮箱</label>
            <input v-model="form.email" class="a-input" type="email" placeholder="you@example.com" />
            <div class="desc">邮箱可用于登录，修改后请用新邮箱登录</div>
          </div>
        </div>
        <div class="a-field">
          <label>个人简介</label>
          <textarea v-model="form.bio" class="a-textarea" style="min-height: 76px" maxlength="120"></textarea>
        </div>
        <div class="a-field">
          <label>个人网站</label>
          <input v-model="form.website" class="a-input" placeholder="https://…" />
        </div>
        <div class="a-actions">
          <button class="a-btn primary" :disabled="saving" @click="saveProfile">保存资料</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>修改密码</h3></div>
      <div class="card-body a-form">
        <div class="a-field">
          <label>原密码</label>
          <input v-model="pwd.old" class="a-input" type="password" autocomplete="current-password" />
        </div>
        <div class="a-row">
          <div class="a-field">
            <label>新密码</label>
            <input v-model="pwd.next" class="a-input" type="password" autocomplete="new-password" />
          </div>
          <div class="a-field">
            <label>确认新密码</label>
            <input v-model="pwd.confirm" class="a-input" type="password" autocomplete="new-password" />
          </div>
        </div>
        <div class="a-actions">
          <button class="a-btn primary" @click="savePassword">更新密码</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h3>登录安全</h3>
        <button class="mini-btn" :disabled="secLoading" @click="loadSecurity">
          {{ secLoading ? '刷新中…' : '刷新' }}
        </button>
      </div>
      <div class="card-body">
        <div class="sec-stats">
          <span class="badge red">近 24 小时失败 {{ sec.stats.fail24 }} 次</span>
          <span class="badge green">成功 {{ sec.stats.ok24 }} 次</span>
          <span v-for="r in sec.rules" :key="r.scope" class="badge gray">
            {{ r.label }}：{{ r.max }} 次 / {{ r.windowMinutes }} 分钟 → 锁 {{ r.lockMinutes }} 分钟
          </span>
        </div>

        <div v-if="sec.locks.length" class="sec-locks">
          <div class="sec-lock-head">
            <strong>当前锁定 {{ sec.locks.length }} 项</strong>
            <button class="mini-btn danger" @click="unlockAll">全部解除</button>
          </div>
          <div v-for="l in sec.locks" :key="l.scope + '|' + l.key" class="list-row">
            <div class="main">
              <strong>{{ l.scopeLabel }}：{{ lockKey(l.key) }}</strong>
              <p>连续失败 {{ l.fails }} 次 · 剩余 {{ waitText(l.retryAfter) }}</p>
            </div>
            <button class="mini-btn" @click="unlockOne(l)">解除</button>
          </div>
        </div>
        <p v-else class="sec-ok">
          <i class="ri-shield-check-line"></i> 当前没有被锁定的 IP 或账号
        </p>

        <div class="sec-sub-row">
          <h4 class="sec-sub">最近登录尝试</h4>
          <button v-if="sec.events.length > EVENT_PREVIEW" class="mini-btn" @click="showAllEvents = !showAllEvents">
            {{ showAllEvents ? '只看最近 ' + EVENT_PREVIEW + ' 条' : `显示全部 ${sec.events.length} 条` }}
          </button>
        </div>
        <div class="sec-events" :class="{ scrollable: showAllEvents }">
          <div v-for="e in shownEvents" :key="e.id" class="sec-event">
            <span class="badge" :class="e.ok ? 'green' : 'red'">{{ e.ok ? '成功' : '失败' }}</span>
            <span class="sec-user">{{ e.username || '—' }}</span>
            <span class="sec-ip">{{ e.ip || '—' }}</span>
            <span class="sec-reason">{{ e.reason || '—' }}</span>
            <span class="sec-time">{{ (e.at || '').slice(5, 16) }}</span>
          </div>
          <p v-if="!sec.events.length" class="hint-block">还没有登录记录</p>
        </div>
        <p class="desc">同一账号 + IP 连续失败 5 次会锁 10 分钟，换 IP 撞库锁账号 5 分钟，单 IP 横扫锁 15 分钟；失败越多锁得越久（最长 1 小时）。锁定期间不会再校验密码。</p>
      </div>
    </div>

    <input ref="avatarInput" type="file" accept="image/*" hidden @change="uploadAvatar" />
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';
import { store, toast } from '../../store.js';

const form = reactive({ nickname: '', avatar: '', bio: '', website: '', email: '' });
const pwd = reactive({ old: '', next: '', confirm: '' });
const saving = ref(false);
const avatarInput = ref(null);

const sec = reactive({
  locks: [],
  events: [],
  rules: [],
  stats: { fail24: 0, ok24: 0 },
});
const secLoading = ref(false);
const EVENT_PREVIEW = 12;
const showAllEvents = ref(false);

const shownEvents = computed(() =>
  showAllEvents.value ? sec.events : sec.events.slice(0, EVENT_PREVIEW)
);

/* 账号+IP 的 key 是 "ip|账号"，展示时拆开更清楚 */
function lockKey(key) {
  return String(key || '').split('|').filter(Boolean).join(' / ');
}

function waitText(sec2) {
  const s = Math.max(0, Number(sec2) || 0);
  if (s >= 60) return `${Math.ceil(s / 60)} 分钟`;
  return `${s} 秒`;
}

async function loadSecurity() {
  secLoading.value = true;
  try {
    const data = await api.get('/api/admin/security');
    sec.locks = data.locks || [];
    sec.events = data.events || [];
    sec.rules = data.rules || [];
    sec.stats = data.stats || { fail24: 0, ok24: 0 };
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    secLoading.value = false;
  }
}

async function unlockOne(l) {
  try {
    await api.post('/api/admin/security/unlock', { scope: l.scope, key: l.key });
    toast('已解除');
    loadSecurity();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function unlockAll() {
  try {
    const r = await api.post('/api/admin/security/unlock', { all: true });
    toast(`已解除 ${r.cleared || 0} 项锁定`);
    loadSecurity();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function fill() {
  const u = store.user || {};
  form.nickname = u.nickname || '';
  form.avatar = u.avatar || '';
  form.bio = u.bio || '';
  form.website = u.website || '';
  form.email = u.email || '';
}

async function uploadAvatar(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = await api.upload([file]);
    form.avatar = data.files[0].url;
    toast('头像已上传，保存后生效');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    e.target.value = '';
  }
}

async function saveProfile() {
  saving.value = true;
  try {
    const data = await api.put('/api/auth/me', {
      nickname: form.nickname,
      avatar: form.avatar,
      bio: form.bio,
      website: form.website,
      email: form.email,
    });
    store.user = data.user;
    toast('资料已保存');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    saving.value = false;
  }
}

async function savePassword() {
  if (!pwd.old || !pwd.next) return toast('请填写完整', 'error');
  if (pwd.next.length < 6) return toast('新密码至少 6 位', 'error');
  if (pwd.next !== pwd.confirm) return toast('两次输入的新密码不一致', 'error');
  try {
    await api.post('/api/auth/password', { oldPassword: pwd.old, newPassword: pwd.next });
    toast('密码已更新');
    pwd.old = pwd.next = pwd.confirm = '';
  } catch (e) {
    toast(e.message, 'error');
  }
}

onMounted(() => {
  fill();
  loadSecurity();
});
</script>
