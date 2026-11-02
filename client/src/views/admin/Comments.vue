<template>
  <div class="card">
    <div class="card-head">
      <h3>评论列表 <span class="hint">共 {{ total }} 条</span></h3>
      <div class="filter-bar">
        <div class="tabs">
          <button
            v-for="t in tabs"
            :key="t.value"
            :class="{ active: status === t.value }"
            @click="switchTab(t.value)"
          >
            {{ t.label }}
          </button>
        </div>
        <input v-model="q" class="a-input" placeholder="搜索评论内容 / 昵称" @keyup.enter="reload" />
        <select v-model="aiStatus" class="a-select" style="width: 128px" @change="reload">
          <option value="">AI 全部</option>
          <option value="unchecked">AI 待审</option>
          <option value="pass">AI 通过</option>
          <option value="reject">AI 违规</option>
          <option value="error">AI 异常</option>
        </select>
        <button class="a-btn" @click="reload"><i class="ri-search-line"></i></button>
      </div>
    </div>

    <div class="table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th style="width: 46%">评论内容</th>
            <th>评论者</th>
            <th>所属动态</th>
            <th>状态</th>
            <th>时间</th>
            <th style="width: 190px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in list" :key="c.id">
            <td>
              <div class="cell-text" style="max-width: 420px">
                <strong style="white-space: normal; line-height: 1.55">{{ plain(c.content) }}</strong>
                <span v-if="c.parent_id">回复 @{{ c.parent_nickname }}：{{ plain(c.parent_content) }}</span>
                <span v-if="c.ai_status === 'reject' || c.ai_status === 'error'" class="ai-reason">
                  AI：{{ c.ai_reason || '未给出理由' }}
                </span>
              </div>
            </td>
            <td>
              <div class="cell-text">
                <strong style="max-width: 120px">{{ c.nickname }}</strong>
                <span>{{ c.email || '游客' }}</span>
              </div>
            </td>
            <td>
              <router-link :to="`/post/${c.post_id}`" class="cell-muted" style="max-width: 180px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                {{ c.post_content || `#${c.post_id}` }}
              </router-link>
            </td>
            <td>
              <div class="status-cell">
                <span
                  class="badge"
                  :class="c.status === 'approved' ? 'green' : c.status === 'pending' ? 'orange' : 'gray'"
                >
                  {{ c.status === 'approved' ? '已通过' : c.status === 'pending' ? '待审核' : '已隐藏' }}
                </span>
                <span class="badge" :class="aiClass(c.ai_status)" :title="c.ai_reason || ''">
                  {{ aiLabel(c.ai_status) }}
                </span>
              </div>
            </td>
            <td><span class="cell-muted">{{ c.created_at?.slice(0, 16) }}</span></td>
            <td>
              <div class="row-actions">
                <button class="mini-btn primary" @click="openReply(c)">回复</button>
                <button v-if="c.status !== 'approved'" class="mini-btn" @click="setStatus(c, 'approved')">通过</button>
                <button v-if="c.status !== 'hidden'" class="mini-btn" @click="setStatus(c, 'hidden')">隐藏</button>
                <button class="mini-btn" title="重新送 AI 审核" @click="recheck(c)">重审</button>
                <button class="mini-btn danger" @click="remove(c)">删除</button>
              </div>
            </td>
          </tr>
          <tr v-if="!list.length">
            <td colspan="6"><div class="hint-block" style="text-align: center">暂无评论</div></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="pager">
      <span>第 {{ page }} / {{ maxPage }} 页</span>
      <button :disabled="page <= 1" @click="go(page - 1)"><i class="ri-arrow-left-s-line"></i></button>
      <button :disabled="!hasMore" @click="go(page + 1)"><i class="ri-arrow-right-s-line"></i></button>
    </div>

    <div v-if="replyTarget" class="a-mask" @click.self="replyTarget = null">
      <div class="a-modal" style="max-width: 460px">
        <div class="a-modal-head">
          <h3>回复 {{ replyTarget.nickname }}</h3>
          <button class="x" @click="replyTarget = null"><i class="ri-close-line"></i></button>
        </div>
        <div class="a-modal-body">
          <div class="hint-block" style="margin-bottom: 12px">{{ plain(replyTarget.content) }}</div>
          <textarea v-model="replyText" class="a-textarea" placeholder="以管理员身份回复…" maxlength="1000"></textarea>
        </div>
        <div class="a-modal-foot">
          <button class="a-btn" @click="replyTarget = null">取消</button>
          <button class="a-btn primary" :disabled="replying" @click="sendReply">
            {{ replying ? '发送中…' : '发送回复' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../../api.js';
import { toast, confirmDialog } from '../../store.js';
import { stickerPlainText } from '../../utils.js';

// 评论正文里的 [s:12] 是表情占位符，后台列表统一显示成「[表情]」
const plain = (t) => stickerPlainText(t || '');

const tabs = [
  { label: '全部', value: '' },
  { label: '已通过', value: 'approved' },
  { label: '待审核', value: 'pending' },
  { label: '已隐藏', value: 'hidden' },
];

const list = ref([]);
const total = ref(0);
const page = ref(1);
const hasMore = ref(false);
const pageSize = 12;
const status = ref('');
const aiStatus = ref('');
const q = ref('');

const AI_LABEL = { unchecked: 'AI 待审', pass: 'AI 通过', reject: 'AI 违规', error: 'AI 异常' };
const aiLabel = (s) => AI_LABEL[s] || 'AI 待审';
function aiClass(s) {
  if (s === 'reject') return 'red';
  if (s === 'pass') return 'green';
  if (s === 'error') return 'orange';
  return 'gray';
}

const replyTarget = ref(null);
const replyText = ref('');
const replying = ref(false);

const maxPage = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

async function load() {
  const qs = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
  if (status.value) qs.set('status', status.value);
  if (aiStatus.value) qs.set('ai_status', aiStatus.value);
  if (q.value.trim()) qs.set('q', q.value.trim());
  const data = await api.get(`/api/admin/comments?${qs}`);
  list.value = data.list;
  total.value = data.total;
  hasMore.value = data.hasMore;
}
function reload() {
  page.value = 1;
  load();
}
function go(p) {
  page.value = p;
  load();
}
function switchTab(v) {
  status.value = v;
  reload();
}

async function setStatus(c, s) {
  try {
    await api.put(`/api/admin/comments/${c.id}`, { status: s });
    c.status = s;
    toast(s === 'approved' ? '已通过' : '已隐藏');
    if (status.value) load();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function recheck(c) {
  try {
    await api.post(`/api/admin/comments/${c.id}/recheck`);
    c.ai_status = 'unchecked';
    c.ai_reason = '';
    toast('已加入待审队列，点「立即审核」或等定时任务');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function remove(c) {
  const ok = await confirmDialog('确定删除这条评论？删除后无法恢复。', { title: '删除评论' });
  if (!ok) return;
  await api.del(`/api/admin/comments/${c.id}`);
  toast('已删除');
  load();
}

function openReply(c) {
  replyTarget.value = c;
  replyText.value = '';
}
async function sendReply() {
  if (!replyText.value.trim()) return toast('请输入回复内容', 'error');
  if ([...replyText.value.trim()].length > 1000) return toast('回复最多 1000 字', 'error');
  replying.value = true;
  try {
    await api.post(`/api/admin/comments/${replyTarget.value.id}/reply`, { content: replyText.value.trim() });
    toast('回复成功');
    replyTarget.value = null;
    load();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    replying.value = false;
  }
}

onMounted(load);
</script>
