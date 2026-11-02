<template>
  <div class="centent">
    <div class="kehua-main">
      <div class="page-head">
        <button class="head-back" @click="$router.push('/')"><i class="ri-arrow-left-line"></i></button>
        <h2>个人主页</h2>
        <button class="head-back" @click="store.searchOpen = true"><i class="ri-search-line"></i></button>
      </div>

      <div v-if="user" class="author-card">
        <img v-lazy.eager="user.avatar || store.settings.avatar" alt="" />
        <div>
          <h3>{{ user.nickname }}</h3>
          <p>{{ user.bio || '这个人很懒，什么也没写' }}</p>
          <div class="author-meta">
            <span><b>{{ user.post_count }}</b> 条动态</span>
            <span><b>{{ user.like_count }}</b> 次被赞</span>
            <span>{{ user.created_at?.slice(0, 10) }} 加入</span>
          </div>
        </div>
      </div>

      <div class="kehua-nrbk">
        <PostCard
          v-for="p in posts"
          :key="p.id"
          :post="p"
          @removed="onRemoved"
          @updated="() => {}"
        />
        <div v-if="!loading && !posts.length" class="empty-state">
          <i class="ri-quill-pen-line"></i>还没有发布动态
        </div>
        <div ref="footerRef" class="footer">
          <div v-if="loading" class="footer-loading">
            <span class="spinner"></span><span class="footer-text">加载中…</span>
          </div>
          <span v-else-if="hasMore" class="footer-text" @click="loadMore">加载更多..</span>
          <span v-else-if="posts.length" class="footer-text done">- 没有更多啦 -</span>
        </div>
      </div>

      <div class="kehua-copyright"><span>{{ store.settings.footer_text }}</span></div>
      <FloatMenu :show-top="true" />
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api.js';
import { store, toast } from '../store.js';
import { useInfiniteScroll } from '../useInfiniteScroll.js';
import PostCard from '../components/PostCard.vue';
import FloatMenu from '../components/FloatMenu.vue';

const route = useRoute();
const user = ref(null);
const posts = ref([]);
const page = ref(1);
const hasMore = ref(false);
const loading = ref(false);
const footerRef = ref(null);

const { fill } = useInfiniteScroll(
  footerRef,
  () => hasMore.value && !loading.value,
  () => load(false)
);

async function loadUser() {
  try {
    user.value = await api.get(`/api/users/${route.params.id}`);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function load(reset = false) {
  if (loading.value) return;
  loading.value = true;
  try {
    const p = reset ? 1 : page.value;
    const data = await api.get(`/api/posts?author=${route.params.id}&page=${p}`);
    posts.value = reset ? data.list : posts.value.concat(data.list);
    page.value = p + 1;
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
function onRemoved(id) {
  posts.value = posts.value.filter((p) => p.id !== id);
  if (user.value) user.value.post_count = Math.max(0, user.value.post_count - 1);
}

function init() {
  posts.value = [];
  page.value = 1;
  loadUser();
  load(true);
}
watch(() => route.params.id, init);
onMounted(init);
</script>
