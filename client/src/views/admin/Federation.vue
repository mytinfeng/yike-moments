<template>
  <div class="card fd-card">
    <div class="card-head">
      <h3>
        友站联动
        <span class="hint">只同步摘要卡片，评论点赞都在对方站点完成</span>
      </h3>
      <div class="filter-bar">
        <button class="a-btn" :disabled="loading" @click="load">
          <i :class="loading ? 'ri-loader-4-line spinning' : 'ri-refresh-line'"></i>刷新
        </button>
      </div>
    </div>

    <div class="card-body">
      <!-- ============ 本站对外 ============ -->
      <div class="fd-block">
        <div class="fd-title">本站对外</div>
        <div class="a-row">
          <div class="a-field">
            <label>允许其他站点订阅本站</label>
            <select v-model="enabled" class="a-select" :disabled="savingSwitch" @change="saveSwitch">
              <option :value="true">开启 —— 持有 Key 的站点可以读取本站最新动态</option>
              <option :value="false">关闭 —— 谁都拉不到</option>
            </select>
            <p class="desc">只对外提供最近 20 条动态的摘要、图片地址和原文链接，不提供全文和数据写入。</p>
          </div>
        </div>

        <div class="a-field">
          <label>授权 Key</label>
          <div class="fd-inline">
            <input class="a-input" :value="key" readonly @focus="$event.target.select()" />
            <button class="a-btn" @click="copy(key)">复制</button>
            <button class="a-btn danger" @click="resetKey">重置</button>
          </div>
          <p class="desc">
            对方要填的接口地址：<code class="fd-code">{{ feedUrl }}</code
            ><br />把 Key 和这个地址一起发给对方站长。重置后旧 Key 立刻失效，正在使用旧 Key 的站点会同步失败。
          </p>
        </div>

        <div class="a-field">
          <label>站点对外地址</label>
          <div class="fd-inline">
            <input
              v-model="originInput"
              class="a-input"
              :placeholder="autoOrigin || 'https://你的域名'"
              @keyup.enter="saveOrigin"
            />
            <button class="a-btn" :disabled="savingOrigin" @click="saveOrigin">
              <i :class="savingOrigin ? 'ri-loader-4-line spinning' : 'ri-save-3-line'"></i>保存
            </button>
          </div>
          <p class="desc">
            留空则自动识别（当前识别为 <code class="fd-code">{{ autoOrigin || '未知' }}</code>）。
            如果服务器前面挂了 nginx / CDN 做 HTTPS，自动识别可能拿到 http 开头的地址，
            导致对方页面把图片当混合内容拦掉 —— 这时手填 <code class="fd-code">https://你的域名</code> 即可。
          </p>
        </div>
      </div>

      <!-- ============ 我订阅的友站 ============ -->
      <div class="fd-block">
        <div class="fd-title">
          我订阅的友站
          <span class="fd-count">{{ friends.length }} / 20</span>
        </div>

        <div class="fd-add">
          <div class="a-row">
            <div class="a-field">
              <label>对方站点地址（只填域名）</label>
              <input
                v-model="form.url"
                class="a-input"
                placeholder="https://blog.example.com"
                @keyup.enter="preview"
              />
            </div>
            <div class="a-field">
              <label>对方给你的授权 Key</label>
              <input v-model="form.key" class="a-input" placeholder="对方后台生成的 Key" />
            </div>
          </div>
          <div class="a-field">
            <label>备注名（可选）</label>
            <input
              v-model="form.name"
              class="a-input"
              maxlength="40"
              placeholder="默认用对方的站点名，比如：老王的博客"
            />
          </div>
          <div class="fd-act">
            <button class="a-btn" :disabled="probing" @click="preview">
              <i :class="probing ? 'ri-loader-4-line spinning' : 'ri-eye-line'"></i>先试拉一下
            </button>
            <button class="a-btn primary" :disabled="adding" @click="add">
              <i :class="adding ? 'ri-loader-4-line spinning' : 'ri-add-line'"></i>添加
            </button>
            <span v-if="addError" class="fd-err">{{ addError }}</span>
          </div>

          <div v-if="previewData" class="fd-preview">
            <div class="fd-preview-head">
              <img
                v-if="previewData.site.avatar"
                :src="previewData.site.avatar"
                class="fd-ava"
                alt=""
                referrerpolicy="no-referrer"
                @error="$event.target.style.display = 'none'"
              />
              <b>{{ previewData.site.name }}</b>
              <span class="fd-ok">试拉成功 · 拿到 {{ previewData.items.length }} 条示例</span>
            </div>
            <ul>
              <li v-for="it in previewData.items" :key="it.id">
                {{ it.excerpt || '（图片动态，没有文字）' }}
              </li>
            </ul>
          </div>
        </div>

        <div v-if="friends.length" class="fd-list">
          <div v-for="f in friends" :key="f.id" class="fd-item">
            <div class="fd-item-main">
              <div class="fd-item-name">
                <b>{{ f.name || f.status.siteName || '友站' }}</b>
                <span class="fd-state" :class="stateClass(f)">
                  <i :class="stateIcon(f)"></i>{{ stateText(f) }}
                </span>
                <span v-if="!f.enabled" class="fd-state off">已停用</span>
              </div>
              <div class="fd-item-url">{{ f.url }}</div>
              <div v-if="f.status.error" class="fd-item-err">{{ f.status.error }}</div>
            </div>
            <div class="fd-item-act">
              <button class="a-btn" :disabled="busy === f.id" @click="refreshOne(f)">
                <i :class="busy === f.id ? 'ri-loader-4-line spinning' : 'ri-refresh-line'"></i>
              </button>
              <select
                class="a-select fd-mini"
                :value="f.enabled ? '1' : '0'"
                @change="toggle(f, $event.target.value === '1')"
              >
                <option value="1">启用</option>
                <option value="0">停用</option>
              </select>
              <button class="a-btn danger" @click="remove(f)"><i class="ri-delete-bin-line"></i></button>
            </div>
          </div>
        </div>
        <div v-else class="fd-empty">
          <i class="ri-planet-line"></i>
          <p>还没有添加友站</p>
          <span>在上面填对方的站点地址和授权 Key，试拉成功后点「添加」，内容会出现在首页底部。</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../../api.js';
import { confirmDialog, toast } from '../../store.js';
import { timeAgo } from '../../utils.js';

const loading = ref(false);
const enabled = ref(false);
const key = ref('');
const friends = ref([]);
const savingSwitch = ref(false);
const probing = ref(false);
const adding = ref(false);
const addError = ref('');
const previewData = ref(null);
const busy = ref('');
const form = ref({ url: '', key: '', name: '' });

/* 站点对外地址：siteOrigin 是后台存的，autoOrigin 是后端按当前请求算出来的 */
const siteOrigin = ref('');
const autoOrigin = ref('');
const originInput = ref('');
const savingOrigin = ref(false);

/* 把 Key 和接口地址一起给出，对方站长照着填就行 */
const feedUrl = computed(() => {
  const base = (siteOrigin.value || autoOrigin.value || location.origin).replace(/\/+$/, '');
  return `${base}/api/federation/feed`;
});

function stateText(f) {
  if (f.status.error) return '同步失败';
  if (!f.status.at) return '还没同步';
  return `${f.status.count} 条 · ${timeAgo(new Date(f.status.at).toISOString())}`;
}
function stateClass(f) {
  if (f.status.error) return 'bad';
  if (!f.status.at) return 'wait';
  return 'good';
}
function stateIcon(f) {
  if (f.status.error) return 'ri-error-warning-line';
  if (!f.status.at) return 'ri-time-line';
  return 'ri-checkbox-circle-line';
}

async function load() {
  loading.value = true;
  try {
    const data = await api.get('/api/admin/federation');
    enabled.value = !!data.enabled;
    key.value = data.key || '';
    siteOrigin.value = data.siteOrigin || '';
    autoOrigin.value = data.autoOrigin || location.origin;
    originInput.value = siteOrigin.value;
    friends.value = Array.isArray(data.friends) ? data.friends : [];
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    loading.value = false;
  }
}

async function saveSwitch() {
  savingSwitch.value = true;
  try {
    const data = await api.put('/api/admin/federation/switch', { enabled: enabled.value });
    key.value = data.key || key.value;
    toast(enabled.value ? '已开启联合订阅' : '已关闭联合订阅');
  } catch (e) {
    enabled.value = !enabled.value;
    toast(e.message, 'error');
  } finally {
    savingSwitch.value = false;
  }
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制');
  } catch {
    toast('复制失败，请手动选中复制', 'error');
  }
}

async function saveOrigin() {
  savingOrigin.value = true;
  try {
    const data = await api.put('/api/admin/federation/origin', { origin: originInput.value.trim() });
    siteOrigin.value = data.siteOrigin || '';
    if (data.autoOrigin) autoOrigin.value = data.autoOrigin;
    originInput.value = siteOrigin.value;
    toast(siteOrigin.value ? '已保存对外地址' : '已改为自动识别');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    savingOrigin.value = false;
  }
}

async function resetKey() {
  const ok = await confirmDialog(
    '重置授权 Key？\n\n旧 Key 会立刻失效，正在用旧 Key 订阅你的站点会同步失败，需要你把新 Key 重新发给他们。',
    { title: '重置授权 Key', okText: '重置' }
  );
  if (!ok) return;
  try {
    const data = await api.post('/api/admin/federation/key');
    key.value = data.key;
    toast('已重置，记得把新 Key 发给对方');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function preview() {
  addError.value = '';
  previewData.value = null;
  probing.value = true;
  try {
    const data = await api.post('/api/admin/federation/preview', {
      url: form.value.url,
      key: form.value.key,
    });
    previewData.value = data;
  } catch (e) {
    addError.value = e.message;
  } finally {
    probing.value = false;
  }
}

async function add() {
  addError.value = '';
  adding.value = true;
  try {
    await api.post('/api/admin/federation/friends', {
      url: form.value.url,
      key: form.value.key,
      name: form.value.name,
    });
    form.value = { url: '', key: '', name: '' };
    previewData.value = null;
    toast('已添加，首页底部马上能看到内容');
    await load();
  } catch (e) {
    addError.value = e.message;
  } finally {
    adding.value = false;
  }
}

async function refreshOne(f) {
  busy.value = f.id;
  try {
    const data = await api.post(`/api/admin/federation/friends/${f.id}/refresh`);
    const r = data.result;
    toast(r.ok ? `同步成功，${r.count} 条` : r.error || '同步失败', r.ok ? 'success' : 'error');
    await load();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    busy.value = '';
  }
}

async function toggle(f, on) {
  try {
    await api.put(`/api/admin/federation/friends/${f.id}`, { enabled: on });
    f.enabled = on;
    toast(on ? '已启用' : '已停用，首页不再显示该站内容');
    if (on) setTimeout(load, 1200);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function remove(f) {
  const ok = await confirmDialog(
    `删除「${f.name || f.url}」？\n\n只是不再订阅对方的动态，对方站点不受影响。`,
    { title: '删除友站', okText: '删除' }
  );
  if (!ok) return;
  try {
    await api.del(`/api/admin/federation/friends/${f.id}`);
    toast('已删除');
    await load();
  } catch (e) {
    toast(e.message, 'error');
  }
}

onMounted(load);
</script>

<style scoped>
/* 表单页不铺满宽屏：和「站点设置」保持同一档宽度，否则 27 寸屏幕上
   卡片会拉到 1600px+，Key 输入框和「复制 / 重置」被扯开半屏 */
.fd-card {
  max-width: 880px;
}
.fd-block {
  padding: 4px 0 22px;
  margin-bottom: 22px;
  border-bottom: 1px solid #eef0f4;
}
.fd-block:last-child {
  border-bottom: 0;
  margin-bottom: 0;
  padding-bottom: 4px;
}
.fd-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 700;
  color: #2c3442;
  margin-bottom: 16px;
}
.fd-count {
  font-size: 11.5px;
  font-weight: 500;
  color: #8a93a3;
}

.fd-inline {
  display: flex;
  gap: 10px;
  max-width: 620px;
}
/* 开关只有两个选项，撑满整行太散 */
.a-row .a-select {
  max-width: 460px;
}
.fd-inline .a-input {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.2px;
  min-width: 0;
}
/* 输入框是 width:100%，不加这个会把两个按钮压成竖排 */
.fd-inline .a-btn {
  flex-shrink: 0;
  white-space: nowrap;
}

.fd-code {
  display: inline-block;
  margin: 3px 0;
  padding: 2px 6px;
  border-radius: 5px;
  background: #f4f6f9;
  font-size: 11.5px;
  word-break: break-all;
}

.fd-act {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 2px;
}
.fd-err {
  font-size: 12px;
  color: #d64545;
}

.fd-preview {
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 10px;
  background: #f7f9fb;
  border: 1px solid #e9edf2;
}
.fd-preview-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.fd-ava {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  object-fit: cover;
}
.fd-ok {
  margin-left: auto;
  font-size: 11.5px;
  color: #1f9d55;
}
.fd-preview ul {
  margin: 10px 0 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fd-preview li {
  font-size: 12.5px;
  line-height: 1.6;
  color: #5a6373;
}

.fd-list {
  display: flex;
  flex-direction: column;
  border: 1px solid #eef0f4;
  border-radius: 10px;
  overflow: hidden;
}
.fd-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 14px;
  border-bottom: 1px solid #f1f3f6;
}
.fd-item:last-child {
  border-bottom: 0;
}
.fd-item-main {
  flex: 1;
  min-width: 0;
}
.fd-item-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  color: #2c3442;
}
.fd-item-name b {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 40%;
}
.fd-item-url {
  margin-top: 3px;
  font-size: 11.5px;
  color: #8a93a3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fd-item-err {
  margin-top: 4px;
  font-size: 11.5px;
  color: #d64545;
}
.fd-item-act {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.fd-mini {
  width: 78px;
  height: 38px;
  padding: 0 8px;
}

.fd-state {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}
.fd-state.good {
  color: #1f9d55;
  background: rgba(31, 157, 85, 0.1);
}
.fd-state.bad {
  color: #d64545;
  background: rgba(214, 69, 69, 0.1);
}
.fd-state.wait,
.fd-state.off {
  color: #8a93a3;
  background: #f2f4f7;
}

.fd-empty {
  padding: 34px 20px;
  text-align: center;
  border: 1px dashed #e3e6ec;
  border-radius: 10px;
}
.fd-empty i {
  font-size: 26px;
  color: #c3c9d4;
}
.fd-empty p {
  margin: 8px 0 4px;
  font-size: 13px;
  color: #5a6373;
}
.fd-empty span {
  font-size: 12px;
  color: #8a93a3;
}

.spinning {
  animation: fd-spin 0.9s linear infinite;
}
@keyframes fd-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
