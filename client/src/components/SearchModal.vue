<template>
  <Teleport to="body">
    <div v-if="store.searchOpen" class="pyq-mask" @click.self="close">
      <div class="pyq-dialog search-dialog">
        <div class="pyq-dialog-head">
          <h3>搜索动态</h3>
          <button class="close" @click="close"><i class="ri-close-line"></i></button>
        </div>
        <div class="pyq-dialog-body">
          <div class="search-input-wrap">
            <i class="ri-search-line"></i>
            <input
              ref="inputRef"
              v-model="keyword"
              placeholder="输入关键词搜索动态…"
              autocomplete="off"
              @input="onInput"
              @keyup.enter="doSearch"
            />
            <button @click="doSearch"><i class="ri-arrow-right-line"></i></button>
          </div>
          <div class="search-results">
            <div v-if="loading" class="search-tip">搜索中…</div>
            <div v-else-if="!keyword.trim()" class="search-tip">输入关键词开始搜索</div>
            <div v-else-if="!results.length" class="search-tip">没有找到相关内容</div>
            <div
              v-for="item in results"
              :key="item.id"
              class="search-item"
              @click="openPost(item.id)"
            >
              <img v-if="item.images && item.images.length" v-lazy="item.images[0]" alt="" />
              <div v-else class="search-item-avatar">
                <img v-lazy.eager="item.avatar || store.settings.avatar" alt="" />
              </div>
              <div class="search-item-main">
                <strong>{{ item.nickname }}</strong>
                <p v-html="highlight(item.excerpt || '（图片动态）')"></p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { store, toast } from '../store.js';
import { escapeHTML, debounce } from '../utils.js';

const router = useRouter();
const keyword = ref('');
const results = ref([]);
const loading = ref(false);
const inputRef = ref(null);

watch(
  () => store.searchOpen,
  async (open) => {
    if (open) {
      await nextTick();
      inputRef.value?.focus();
    } else {
      keyword.value = '';
      results.value = [];
    }
  }
);

const runSearch = debounce(async () => {
  const q = keyword.value.trim();
  if (!q) {
    results.value = [];
    loading.value = false;
    return;
  }
  try {
    const data = await api.get(`/api/search?q=${encodeURIComponent(q)}`);
    results.value = data.list || [];
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    loading.value = false;
  }
}, 320);

function onInput() {
  loading.value = true;
  runSearch();
}
function doSearch() {
  loading.value = true;
  runSearch();
}
function highlight(text) {
  const safe = escapeHTML(text);
  const q = escapeHTML(keyword.value.trim());
  if (!q) return safe;
  try {
    return safe.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`);
  } catch {
    return safe;
  }
}
function close() {
  store.searchOpen = false;
}
function openPost(id) {
  close();
  router.push(`/post/${id}`);
}
</script>

<style scoped>
.search-dialog {
  max-width: 440px;
}
.search-item-avatar img {
  width: 46px;
  height: 46px;
  border-radius: 5px;
  object-fit: cover;
}
</style>
