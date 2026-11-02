<template>
  <Teleport to="body">
    <div v-if="store.guestOpen" class="pyq-mask" @click.self="close">
      <div class="pyq-dialog gp-dialog">
        <div class="pyq-dialog-head">
          <h3>信息登记</h3>
          <button class="close" type="button" @click="close">
            <i class="ri-close-line"></i>
          </button>
        </div>

        <div class="pyq-dialog-body">
          <!-- 已登录：账号昵称会覆盖访客信息，没必要再填 -->
          <template v-if="store.user">
            <p class="gp-tip">
              你已经以 <b>{{ store.user.nickname || store.user.username }}</b> 登录，评论和点赞都会用账号昵称，不需要再登记。
            </p>
            <button class="btn-primary" type="button" @click="close">知道了</button>
          </template>

          <form v-else class="gp-form" @submit.prevent="submit">
            <p class="gp-tip">填一次就够了：以后评论自动带上，点赞也会显示这个名字。</p>

            <label class="gp-field">
              <span>昵称<i>*</i></span>
              <input v-model="form.nickname" maxlength="16" placeholder="别人看到的名字" />
            </label>

            <label class="gp-field">
              <span>邮箱<i>*</i></span>
              <input v-model="form.email" maxlength="60" placeholder="不会公开，只在后台可见" />
            </label>

            <label class="gp-field">
              <span>网站</span>
              <input v-model="form.website" maxlength="100" placeholder="选填，http:// 或 https://" />
            </label>

            <p v-if="error" class="gp-error">{{ error }}</p>

            <button class="btn-primary" type="submit" :disabled="saving">
              {{ saving ? '保存中…' : '保存' }}
            </button>

            <p class="gp-note">
              昵称会显示在你点过赞的动态下面；信息存在本机浏览器，换设备需要重新登记。
            </p>
          </form>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { reactive, ref, watch } from 'vue';
import { api } from '../api.js';
import { loadGuestProfile, saveGuestProfile, store, toast } from '../store.js';

const form = reactive({ nickname: '', email: '', website: '' });
const error = ref('');
const saving = ref(false);

/* 每次打开都从本地读一遍，避免别处（比如评论框）刚改过这里还是旧值 */
watch(
  () => store.guestOpen,
  (open) => {
    if (!open) return;
    const saved = loadGuestProfile();
    form.nickname = saved.nickname;
    form.email = saved.email;
    form.website = saved.website;
    error.value = '';
  }
);

function close() {
  store.guestOpen = false;
}

/** 校验规则和评论框保持一致，避免「这边能存、评论时被服务端打回」 */
function validate() {
  const nick = form.nickname.trim();
  if (!nick) return '请填写昵称';
  if (/[<>]/.test(nick)) return '昵称不能包含 < > 符号';
  if ([...nick].length > 16) return '昵称最多 16 字';

  const mail = form.email.trim();
  if (!mail) return '请填写邮箱';
  if (!/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(mail)) return '请填写正确的邮箱';

  const site = form.website.trim();
  if (site && /^[a-z][a-z0-9+.-]*:/i.test(site) && !/^https?:/i.test(site)) {
    return '网站只支持 http / https 链接';
  }
  return '';
}

async function submit() {
  const bad = validate();
  if (bad) {
    error.value = bad;
    return;
  }
  error.value = '';
  saving.value = true;

  const payload = {
    nickname: form.nickname.trim(),
    email: form.email.trim(),
    website: form.website.trim(),
  };
  saveGuestProfile(payload);

  try {
    /* 把昵称回写到这位访客已经点过的赞上，登记之前点的也能显示名字 */
    const r = await api.post('/api/guest/profile', { nickname: payload.nickname });
    toast(r?.updated ? `已保存，${r.updated} 个历史点赞也换成昵称了` : '信息已保存');
  } catch {
    /* 回写失败不影响本地保存，下次点赞还会带上昵称 */
    toast('信息已保存');
  } finally {
    saving.value = false;
    store.guestOpen = false;
  }
}
</script>

<style scoped>
.gp-dialog {
  max-width: 380px;
}
.gp-tip {
  font-size: 13px;
  line-height: 1.7;
  color: var(--texths);
  margin-bottom: 14px;
}
.gp-form {
  display: block;
}
.gp-field {
  display: block;
  margin-bottom: 12px;
}
.gp-field > span {
  display: block;
  font-size: 12px;
  color: var(--texths);
  margin-bottom: 6px;
}
.gp-field > span i {
  font-style: normal;
  color: #f5533d;
  margin-left: 2px;
}
.gp-field input {
  width: 100%;
  height: 42px;
  padding: 0 12px;
  font-size: 14px;
  color: var(--textqh);
  background: var(--backbg);
  border: 1px solid transparent;
  border-radius: 8px;
  transition: border-color 0.18s;
}
.gp-field input:focus {
  border-color: var(--theme);
}
.gp-field input::placeholder {
  color: var(--texths);
  opacity: 0.85;
}
.gp-error {
  font-size: 12px;
  color: #f5533d;
  margin: -2px 0 10px;
}
.gp-note {
  font-size: 11px;
  line-height: 1.6;
  color: var(--texths);
  opacity: 0.8;
  margin-top: 10px;
  text-align: center;
}
</style>
