<template>
  <div class="card">
    <div class="card-head">
      <h3>动态列表 <span class="hint">共 {{ total }} 条</span></h3>
      <div class="filter-bar">
        <input v-model="q" class="a-input" placeholder="搜索内容 / 昵称" @keyup.enter="reload" />
        <select v-model="status" class="a-select" @change="reload">
          <option value="">全部状态</option>
          <option value="published">已发布</option>
          <option value="draft">草稿</option>
        </select>
        <button class="a-btn" @click="reload"><i class="ri-search-line"></i>查询</button>
        <button class="a-btn primary" @click="$router.push('/write')"><i class="ri-add-line"></i>新建动态</button>
      </div>
    </div>

    <div class="table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th style="width: 44%">内容</th>
            <th>作者</th>
            <th>互动</th>
            <th>状态</th>
            <th>时间</th>
            <th style="width: 264px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in list" :key="p.id">
            <td>
              <div class="cell-main">
                <img
                  v-if="p.images.length"
                  class="cell-thumb"
                  :src="p.images[0]"
                  alt=""
                />
                <div v-else class="cell-thumb" style="display: flex; align-items: center; justify-content: center; color: #b6bdc9">
                  <i class="ri-file-text-line" style="font-size: 18px"></i>
                </div>
                <div class="cell-text">
                  <strong>{{ p.content || '（无文字内容）' }}</strong>
                  <span>
                    #{{ p.id }}
                    <template v-if="p.images.length"> · {{ p.images.length }} 张图</template>
                    <template v-if="p.music"> · 音乐</template>
                    <template v-if="p.location"> · {{ p.location }}</template>
                  </span>
                </div>
              </div>
            </td>
            <td>
              <div class="cell-main">
                <img class="cell-thumb" style="width: 28px; height: 28px; border-radius: 50%" :src="p.avatar" alt="" />
                <span>{{ p.nickname }}</span>
              </div>
            </td>
            <td><span class="cell-muted">{{ p.like_count }} 赞 · {{ p.comment_count }} 评</span></td>
            <td>
              <span v-if="p.is_pinned" class="badge green">置顶</span>
              <span v-if="p.is_ad" class="badge gray" style="margin-left: 4px">广告</span>
              <span v-if="!p.is_pinned && !p.is_ad" class="badge">普通</span>
            </td>
            <td><span class="cell-muted">{{ p.created_at?.slice(0, 16) }}</span></td>
            <td>
              <div class="row-actions">
                <button class="mini-btn primary" @click="$router.push(`/post/${p.id}`)">查看</button>
                <button class="mini-btn" @click="$router.push(`/write?edit=${p.id}`)">编辑</button>
                <button class="mini-btn" @click="togglePin(p)">{{ p.is_pinned ? '取消置顶' : '置顶' }}</button>
                <button class="mini-btn danger" @click="remove(p)">删除</button>
              </div>
            </td>
          </tr>
          <tr v-if="!list.length">
            <td colspan="6">
              <div class="hint-block" style="text-align: center">暂无数据</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="pager">
      <span>第 {{ page }} / {{ maxPage }} 页</span>
      <button :disabled="page <= 1" @click="go(page - 1)"><i class="ri-arrow-left-s-line"></i></button>
      <button :disabled="!hasMore" @click="go(page + 1)"><i class="ri-arrow-right-s-line"></i></button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../../api.js';
import { toast, confirmDialog } from '../../store.js';

const list = ref([]);
const total = ref(0);
const page = ref(1);
const hasMore = ref(false);
const pageSize = 10;
const q = ref('');
const status = ref('');

const maxPage = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

async function load() {
  const qs = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
  if (q.value.trim()) qs.set('q', q.value.trim());
  if (status.value) qs.set('status', status.value);
  const data = await api.get(`/api/admin/posts?${qs}`);
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

async function togglePin(p) {
  try {
    await api.put(`/api/posts/${p.id}`, { is_pinned: !p.is_pinned });
    p.is_pinned = !p.is_pinned;
    toast(p.is_pinned ? '已置顶' : '已取消置顶');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function remove(p) {
  const ok = await confirmDialog(`确定删除动态 #${p.id}？该操作不可恢复，相关评论和点赞会一并删除。`, {
    title: '删除动态',
  });
  if (!ok) return;
  try {
    await api.del(`/api/posts/${p.id}`);
    toast('已删除');
    load();
  } catch (e) {
    toast(e.message, 'error');
  }
}

onMounted(load);
</script>
