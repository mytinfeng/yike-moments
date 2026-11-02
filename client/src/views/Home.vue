<template>
  <div class="centent">
    <div class="kehua-main">
      <TopBar :scrolled="scrolled" :month="month" show-filter @filter="selectMonth" />

      <Cover />
      <ProfileHead />

      <div ref="feedRef" class="kehua-nrbk">
        <template v-if="loading && !posts.length">
          <div v-for="i in 4" :key="i" class="sk-post">
            <div class="skeleton sk-avatar"></div>
            <div class="sk-lines">
              <div class="skeleton sk-line" style="width: 30%"></div>
              <div class="skeleton sk-line" style="width: 90%"></div>
              <div class="skeleton sk-line" style="width: 70%"></div>
            </div>
          </div>
        </template>

        <!-- 本人动态和好友站点的摘要按位置穿插，不是全堆在底部 -->
        <template v-for="row in merged" :key="row.key">
          <PostCard
            v-if="row.t === 'p'"
            :post="row.post"
            @removed="onRemoved"
            @updated="onUpdated"
          />
          <FriendPost v-else :item="row.item" @muted="onMuted" />
        </template>

        <div v-if="!loading && !posts.length" class="empty-state">
          <i class="ri-quill-pen-line"></i>
          {{ month ? '这个月还没有动态' : '还没有动态，去发布第一条吧' }}
        </div>

        <!-- 全被屏蔽了：留一条恢复入口，否则访客误点一次得等 7 天 -->
        <div v-if="friendHidden && !month" class="fp-restore">
          <i class="ri-eye-off-line"></i>
          <span>已隐藏好友内容</span>
          <span>·</span>
          <button @click="unmute">恢复显示</button>
        </div>

        <div ref="footerRef" class="footer">
          <div v-if="loading && posts.length" class="footer-loading">
            <span class="spinner"></span><span class="footer-text">加载中…</span>
          </div>
          <span v-else-if="hasMore" class="footer-text" @click="loadMore">加载更多..</span>
          <span v-else-if="posts.length" class="footer-text done">- 没有更多啦 -</span>
        </div>
      </div>

      <!-- 友站动态已经穿插在上面了，这里只留版权 -->

      <div class="kehua-copyright">
        <span>{{ store.settings.footer_text }}</span>
      </div>

      <FloatMenu :show-top="showTop" />
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { store, toast, unmuteFriendSites } from '../store.js';
import { useInfiniteScroll } from '../useInfiniteScroll.js';
import TopBar from '../components/TopBar.vue';
import Cover from '../components/Cover.vue';
import ProfileHead from '../components/ProfileHead.vue';
import PostCard from '../components/PostCard.vue';
import FriendPost from '../components/FriendPost.vue';
import FloatMenu from '../components/FloatMenu.vue';

const posts = ref([]);
const month = ref('');
const page = ref(1);
const hasMore = ref(false);
const loading = ref(false);
const scrolled = ref(false);
const showTop = ref(false);
const feedRef = ref(null);
const footerRef = ref(null);

/* ---- 友站动态：只放内存，拉不到就当没有 ---- */
const friendItems = ref([]);
const friendHidden = ref(false);
const ownTotal = ref(0);

/**
 * 本人动态 + 好友条目合并成一条列表。
 *
 * 好友条目均匀插进第一屏的动态之间，而不是一坨堆在底部 ——
 * 位置只跟「服务端 total / 每页条数」有关，翻页加载更多时已经显示的条目不会跳位。
 */
const merged = computed(() => {
  const rows = [];
  /* 最多插 8 条：好友内容是补充，对方一口气发 20 条也不该把自己的主页淹掉 */
  const extra =
    !month.value && !friendHidden.value ? friendItems.value.slice(0, 8) : [];
  const slots = new Map();

  if (extra.length) {
    /* 分布范围取「一屏能装下的条数」而不是全部动态：
       本站有 100 条时若按总数均分，好友内容会全被推到第 10 屏之后，等于没插。
       位置只由 total / 每页条数决定，翻页加载更多时不会重排。 */
    const pageSize = Number(store.settings.page_size) || 8;
    const span = Math.max(1, Math.min(ownTotal.value || posts.value.length, pageSize));
    const step = span / (extra.length + 1);
    extra.forEach((it, i) => {
      const at = Math.max(0, Math.min(posts.value.length - 1, Math.round(step * (i + 1)) - 1));
      const arr = slots.get(at) || [];
      arr.push(it);
      slots.set(at, arr);
    });
  }

  posts.value.forEach((p, idx) => {
    rows.push({ t: 'p', key: `p${p.id}`, post: p });
    for (const it of slots.get(idx) || []) {
      rows.push({ t: 'f', key: `f${it.siteId}:${it.id}`, item: it });
    }
  });

  /* 一条本人动态都没有时，好友内容也要能显示出来 */
  if (extra.length && !posts.value.length) {
    for (const it of extra) rows.push({ t: 'f', key: `f${it.siteId}:${it.id}`, item: it });
  }
  return rows;
});

/* 滚动到底自动加载：占位元素快进视口就取下一页 */
const { fill } = useInfiniteScroll(
  footerRef,
  () => hasMore.value && !loading.value,
  () => load(false)
);

async function load(reset = false) {
  if (loading.value) return;
  loading.value = true;
  try {
    const p = reset ? 1 : page.value;
    const qs = new URLSearchParams({ page: String(p) });
    if (month.value) qs.set('month', month.value);
    const data = await api.get(`/api/posts?${qs}`);
    posts.value = reset ? data.list : posts.value.concat(data.list);
    /* 好友条目按总条数算位置，翻页时位置才稳定 */
    if (!month.value) ownTotal.value = Number(data.total) || 0;
    page.value = p + 1;
    // 空页就别再往下要了，避免 hasMore 异常时打转
    hasMore.value = data.hasMore && data.list.length > 0;
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    loading.value = false;
  }
  fill();
}

function loadMore() {
  load(false);
}

async function loadFriends() {
  try {
    const data = await api.get('/api/friends');
    friendItems.value = Array.isArray(data?.items) ? data.items : [];
    friendHidden.value = !!data?.hidden;
  } catch {
    /* 友站内容是附加信息：拉不到就整块不显示，不给访客看报错 */
    friendItems.value = [];
    friendHidden.value = false;
  }
}

/** 点了某条卡片的「好友」标签：把这个站点整站摘掉 */
function onMuted(mutedIds) {
  const list = Array.isArray(mutedIds) ? mutedIds : [];
  friendItems.value = friendItems.value.filter((x) => !list.includes(x.siteId));
  if (!friendItems.value.length) friendHidden.value = true;
}

async function unmute() {
  unmuteFriendSites();
  friendHidden.value = false;
  await loadFriends();
}
function selectMonth(m) {
  if (month.value === m) return;
  month.value = m;
  posts.value = [];
  load(true);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function onRemoved(id) {
  posts.value = posts.value.filter((p) => p.id !== id);
}
function onUpdated() {}

function onScroll() {
  const y = window.scrollY;
  scrolled.value = y > 40;
  showTop.value = y > 360;
}
onMounted(() => {
  load(true);
  loadFriends();
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
});
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll));
</script>
