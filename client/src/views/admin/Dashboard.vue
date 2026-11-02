<template>
  <div v-if="data">
    <div class="stat-grid">
      <div v-for="s in cards" :key="s.label" class="stat-card">
        <div class="stat-icon" :style="{ background: s.bg, color: s.color }"><i :class="s.icon"></i></div>
        <div class="label">{{ s.label }}</div>
        <div class="value">{{ s.value }}</div>
        <div class="delta" v-html="s.delta"></div>
      </div>
    </div>

    <div class="dash-grid">
      <div class="card">
        <div class="card-head">
          <h3>最近 14 天发布趋势</h3>
          <span class="hint">按天统计动态数量</span>
        </div>
        <div class="card-body">
          <div class="trend-chart">
            <div v-for="d in trend" :key="d.day" class="trend-col">
              <div class="trend-bar" :style="{ height: barHeight(d.count) }" :title="`${d.day}：${d.count} 条`"></div>
              <span>{{ d.label }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>快捷操作</h3></div>
        <div class="card-body" style="display: flex; flex-direction: column; gap: 10px">
          <button class="a-btn" style="justify-content: flex-start" @click="$router.push('/write')">
            <i class="ri-quill-pen-line"></i> 发布一条新动态
          </button>
          <button class="a-btn" style="justify-content: flex-start" @click="$router.push('/admin/posts')">
            <i class="ri-file-list-3-line"></i> 管理全部动态（{{ stats.posts }}）
          </button>
          <button class="a-btn" style="justify-content: flex-start" @click="$router.push('/admin/comments')">
            <i class="ri-chat-check-line"></i> 处理评论
            <span v-if="stats.pending_comments" class="badge orange" style="margin-left: auto">
              {{ stats.pending_comments }} 待审
            </span>
          </button>
          <button class="a-btn" style="justify-content: flex-start" @click="$router.push('/admin/settings')">
            <i class="ri-palette-line"></i> 修改站点封面与外观
          </button>
        </div>
      </div>
    </div>

    <div class="dash-grid" style="margin-top: 16px">
      <div class="card">
        <div class="card-head">
          <h3>最近动态</h3>
          <router-link to="/admin/posts" class="mini-btn">全部 <i class="ri-arrow-right-line"></i></router-link>
        </div>
        <div class="card-body" style="padding-top: 4px; padding-bottom: 8px">
          <div v-for="p in data.recentPosts" :key="p.id" class="list-row">
            <div class="main">
              <strong>
                <span class="name" :title="p.nickname">{{ p.nickname }}</span>
                <span v-if="p.is_pinned" class="badge green">置顶</span>
                <span v-if="p.is_ad" class="badge gray">广告</span>
              </strong>
              <p :title="p.content || '（图片动态）'">{{ p.content || '（图片动态）' }}</p>
            </div>
            <div class="meta">
              <div>{{ p.like_count }} 赞 · {{ p.comment_count }} 评</div>
              <div>{{ p.created_at?.slice(5, 16) }}</div>
            </div>
          </div>
          <div v-if="!data.recentPosts.length" class="hint-block">还没有动态</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>最近评论</h3>
          <router-link to="/admin/comments" class="mini-btn">全部</router-link>
        </div>
        <div class="card-body" style="padding-top: 4px; padding-bottom: 8px">
          <div v-for="c in data.recentComments" :key="c.id" class="list-row">
            <div class="main">
              <strong>
                <span class="name" :title="c.nickname">{{ c.nickname }}</span>
                <span
                  class="badge"
                  :class="c.status === 'approved' ? 'green' : c.status === 'pending' ? 'orange' : 'gray'"
                >
                  {{ c.status === 'approved' ? '已通过' : c.status === 'pending' ? '待审核' : '已隐藏' }}
                </span>
              </strong>
              <p :title="plain(c.content)">{{ plain(c.content) }}</p>
            </div>
            <div class="meta">{{ c.created_at?.slice(5, 16) }}</div>
          </div>
          <div v-if="!data.recentComments.length" class="hint-block">还没有评论</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../../api.js';
import { stickerPlainText } from '../../utils.js';

const plain = (t) => stickerPlainText(t || '');
const data = ref(null);
const stats = computed(() => data.value?.stats || {});

const cards = computed(() => [
  {
    label: '动态总数',
    value: stats.value.posts ?? 0,
    icon: 'ri-quill-pen-line',
    bg: 'rgba(9,195,98,.1)',
    color: '#09c362',
    delta: `今日新增 <b>${stats.value.today_posts ?? 0}</b> 条`,
  },
  {
    label: '评论总数',
    value: stats.value.comments ?? 0,
    icon: 'ri-chat-3-line',
    bg: 'rgba(47,128,237,.1)',
    color: '#2f80ed',
    delta: `今日新增 <b>${stats.value.today_comments ?? 0}</b> 条 · 待审 ${stats.value.pending_comments ?? 0}`,
  },
  {
    label: '点赞总数',
    value: stats.value.likes ?? 0,
    icon: 'ri-heart-3-line',
    bg: 'rgba(235,87,87,.1)',
    color: '#eb5757',
    delta: `今日新增 <b>${stats.value.today_likes ?? 0}</b> 次`,
  },
  {
    label: '注册用户',
    value: stats.value.users ?? 0,
    icon: 'ri-group-line',
    bg: 'rgba(242,153,74,.12)',
    color: '#f2994a',
    delta: `今日新增 <b>${stats.value.users_today ?? 0}</b> 人`,
  },
]);

const trend = computed(() => {
  const map = new Map((data.value?.trend || []).map((t) => [t.d, t.n]));
  const out = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const p = (n) => String(n).padStart(2, '0');
    const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    out.push({ day: key, label: `${d.getMonth() + 1}/${d.getDate()}`, count: map.get(key) || 0 });
  }
  return out;
});

const maxCount = computed(() => Math.max(1, ...trend.value.map((t) => t.count)));
function barHeight(c) {
  return `${Math.max(3, (c / maxCount.value) * 118)}px`;
}

onMounted(async () => {
  data.value = await api.get('/api/admin/stats');
});
</script>
