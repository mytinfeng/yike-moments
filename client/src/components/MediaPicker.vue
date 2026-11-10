<template>
  <div v-if="open" class="a-mask mp-mask" @click.self="close">
    <div class="a-modal mp-modal">
      <div class="a-modal-head">
        <h3>
          {{ titleText }}
          <span class="mp-count">共 {{ total }} 个</span>
        </h3>
        <button class="x" @click="close"><i class="ri-close-line"></i></button>
      </div>

      <div class="mp-bar">
        <input
          v-model="keyword"
          class="a-input"
          :placeholder="placeholder"
          @keyup.enter="reload"
        />
        <button class="a-btn" :disabled="loading" @click="reload">
          <i :class="loading ? 'ri-loader-4-line spinning' : 'ri-search-line'"></i>搜索
        </button>
      </div>

      <div ref="bodyRef" class="a-modal-body mp-body" @scroll="onScroll">
        <div v-if="errorMsg" class="mp-state mp-err">{{ errorMsg }}</div>

        <div v-else-if="!items.length && !loading" class="mp-state">
          <i class="ri-folder-open-line"></i>
          <p>{{ keyword.trim() ? '没有匹配的文件' : '媒体库还是空的' }}</p>
          <span>{{ keyword.trim() ? '换个关键词试试' : '先去上传几张，这里会按上传时间倒序出现' }}</span>
        </div>

        <div v-else class="mp-grid">
          <button
            v-for="m in items"
            :key="m.url"
            class="mp-cell"
            :class="{ on: picked.has(m.url), off: excludedSet.has(m.url) }"
            :title="m.name"
            @click="toggle(m)"
          >
            <img v-if="m.kind === 'image' && !m.broken" :src="m.url" :alt="m.name" loading="lazy" @error="m.broken = true" />
            <i v-else-if="m.broken" class="ri-image-line"></i>
            <video v-else-if="m.kind === 'video'" :src="m.url" preload="metadata" muted></video>
            <i v-else :class="iconOf(m.kind)"></i>

            <span v-if="picked.has(m.url)" class="mp-check"><i class="ri-check-line"></i></span>
            <span v-else-if="excludedSet.has(m.url)" class="mp-flag">已在用</span>
            <span class="mp-size">{{ humanSize(m.size) }}</span>
          </button>
        </div>

        <div ref="sentinel" class="mp-sentinel">
          <span v-if="loadingMore"><i class="ri-loader-4-line spinning"></i> 加载中…</span>
          <span v-else-if="items.length && !hasMore">已经到底了</span>
        </div>
      </div>

      <div class="mp-foot">
        <span class="mp-hint">
          {{ multiple ? `已选 ${picked.size}${max ? ' / ' + max : ''} 项` : '点一下即选中并关闭' }}
        </span>
        <button class="a-btn" @click="close">取消</button>
        <button v-if="multiple" class="a-btn primary" :disabled="!picked.size" @click="confirm">
          使用选中的 {{ picked.size }} 项
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { api } from '../api.js';
import { toast } from '../store.js';

const props = defineProps({
  open: { type: Boolean, default: false },
  /** image | video | audio */
  type: { type: String, default: 'image' },
  multiple: { type: Boolean, default: false },
  /** 多选上限，0 表示不限 */
  max: { type: Number, default: 0 },
  /** 已在用的地址，置灰不可重复选 */
  exclude: { type: Array, default: () => [] },
  title: { type: String, default: '' },
});
const emit = defineEmits(['update:open', 'select']);

const PAGE_SIZE = 48;

const items = ref([]);
const total = ref(0);
const page = ref(0);
const hasMore = ref(true);
const loading = ref(false);
const loadingMore = ref(false);
const errorMsg = ref('');
const keyword = ref('');
const bodyRef = ref(null);
const sentinel = ref(null);

const picked = reactive(new Set());
const excludedSet = computed(() => new Set(props.exclude || []));

const titleText = computed(() => props.title || (props.type === 'video' ? '选择视频' : props.type === 'audio' ? '选择音频' : '选择图片'));
const placeholder = computed(() =>
  props.type === 'video' ? '搜视频文件名，如 2026 或 cover' : props.type === 'audio' ? '搜音频文件名，如 mp3 或 bgm' : '搜图片文件名 / 目录，如 2026 或 cover'
);

function iconOf(kind) {
  if (kind === 'video') return 'ri-video-line';
  if (kind === 'audio') return 'ri-music-2-line';
  return 'ri-file-3-line';
}

function humanSize(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

async function fetchPage(p) {
  const qs = new URLSearchParams({
    type: props.type,
    used: 'all',
    q: keyword.value.trim(),
    page: String(p),
    pageSize: String(PAGE_SIZE),
  });
  const data = await api.get(`/api/admin/media?${qs}`);
  return data;
}

async function reload() {
  loading.value = true;
  errorMsg.value = '';
  items.value = [];
  page.value = 0;
  hasMore.value = true;
  try {
    const data = await fetchPage(1);
    items.value = data.items || [];
    total.value = data.total || 0;
    page.value = data.page || 1;
    hasMore.value = (data.page || 1) < (data.maxPage || 1);
    await nextTick();
    observeSentinel();
  } catch (e) {
    errorMsg.value =
      e.status === 401 || e.status === 403
        ? '只有管理员能打开媒体库'
        : e.status === 404
          ? '媒体库接口不存在，请重启后端后再试'
          : `加载失败：${e.message}`;
  } finally {
    loading.value = false;
  }
}

async function loadMore() {
  if (loading.value || loadingMore.value || !hasMore.value) return;
  loadingMore.value = true;
  try {
    const next = page.value + 1;
    const data = await fetchPage(next);
    const exist = new Set(items.value.map((x) => x.url));
    for (const it of data.items || []) if (!exist.has(it.url)) items.value.push(it);
    page.value = data.page || next;
    total.value = data.total || total.value;
    hasMore.value = page.value < (data.maxPage || 1);
  } catch {
    hasMore.value = false;
  } finally {
    loadingMore.value = false;
  }
}

/* 触底自动续一页：弹窗里翻页按钮太笨，滚到哪加载到哪 */
let io = null;
function observeSentinel() {
  unobserve();
  if (typeof IntersectionObserver === 'undefined') return;
  if (!sentinel.value || !bodyRef.value) return;
  io = new IntersectionObserver(
    (ents) => {
      if (ents.some((e) => e.isIntersecting)) loadMore();
    },
    { root: bodyRef.value, rootMargin: '200px' }
  );
  io.observe(sentinel.value);
}
function unobserve() {
  if (io) io.disconnect();
  io = null;
}

function onScroll() {
  /* IntersectionObserver 在个别环境下不触发时兜底 */
  const el = bodyRef.value;
  if (!el || loadingMore.value || !hasMore.value) return;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) loadMore();
}

function toggle(m) {
  if (excludedSet.value.has(m.url)) {
    toast('这个文件已经在用了', 'error');
    return;
  }
  if (!props.multiple) {
    emit('select', [m.url]);
    close();
    return;
  }
  if (picked.has(m.url)) {
    picked.delete(m.url);
    return;
  }
  if (props.max && picked.size >= props.max) {
    toast(`最多还能选 ${props.max} 项`, 'error');
    return;
  }
  picked.add(m.url);
}

function confirm() {
  if (!picked.size) return;
  emit('select', [...picked]);
  close();
}

function close() {
  emit('update:open', false);
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      picked.clear();
      keyword.value = '';
      items.value = [];
      total.value = 0;
      errorMsg.value = '';
      hasMore.value = true;
      reload();
    } else {
      unobserve();
    }
  }
);

onBeforeUnmount(unobserve);
</script>

<style scoped>
/* 这个弹窗同时在前台（发布页）和后台（设置页）用。
   --a-* 那套变量只在 .admin-root 里定义，前台拿不到，
   所以在这里补一份兜底值，否则边框、文字色会全部失效 */
.mp-mask {
  z-index: 1200;
  --a-line: #ecedf2;
  --a-text: #1d2430;
  --a-sub: #6b7484;
  --a-primary: var(--theme, #09c362);
  --a-primary-dark: #06a854;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 14px;
  color: var(--a-text);
}
.mp-modal {
  max-width: 760px;
}
.mp-count {
  font-size: 12px;
  font-weight: 400;
  color: var(--a-sub);
  margin-left: 8px;
}
.mp-bar {
  display: flex;
  gap: 8px;
  padding: 12px 20px 0;
}
.mp-bar .a-input {
  flex: 1;
}
.mp-body {
  min-height: 260px;
  padding: 14px 20px 4px;
}
.mp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 10px;
}
.mp-cell {
  position: relative;
  aspect-ratio: 1 / 1;
  border: 2px solid transparent;
  border-radius: 10px;
  overflow: hidden;
  background: #f6f8fa;
  padding: 0;
  cursor: pointer;
  display: block;
  transition: border-color 0.15s, transform 0.15s;
}
.mp-cell:hover {
  transform: translateY(-1px);
  border-color: rgba(9, 195, 98, 0.45);
}
.mp-cell.on {
  border-color: var(--a-primary);
}
.mp-cell.off {
  cursor: not-allowed;
}
.mp-cell img,
.mp-cell video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.mp-cell > i {
  font-size: 26px;
  color: #b6c0ce;
}
.mp-cell.off img,
.mp-cell.off video {
  opacity: 0.35;
}
.mp-check {
  position: absolute;
  right: 5px;
  top: 5px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--a-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  box-shadow: 0 1px 4px rgba(16, 24, 40, 0.25);
}
.mp-flag {
  position: absolute;
  left: 5px;
  top: 5px;
  font-size: 10px;
  line-height: 1;
  padding: 3px 5px;
  border-radius: 4px;
  color: #fff;
  background: rgba(16, 24, 40, 0.55);
}
.mp-size {
  position: absolute;
  right: 4px;
  bottom: 4px;
  font-size: 10px;
  line-height: 1;
  padding: 3px 4px;
  border-radius: 4px;
  color: #fff;
  background: rgba(16, 24, 40, 0.42);
  opacity: 0;
  transition: opacity 0.15s;
}
.mp-cell:hover .mp-size {
  opacity: 1;
}
.mp-state {
  min-height: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  color: var(--a-sub);
  font-size: 12.5px;
}
.mp-state i {
  font-size: 34px;
  color: #ccd3de;
}
.mp-state p {
  margin: 6px 0 0;
  font-size: 13.5px;
  color: var(--a-text);
}
.mp-err {
  color: #c0392b;
}
.mp-sentinel {
  text-align: center;
  font-size: 12px;
  color: var(--a-sub);
  padding: 14px 0 6px;
}
.mp-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--a-line);
}
.mp-hint {
  flex: 1;
  font-size: 12.5px;
  color: var(--a-sub);
}
.spinning {
  display: inline-block;
  animation: mp-spin 0.9s linear infinite;
}
@keyframes mp-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 560px) {
  .mp-grid {
    grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
    gap: 8px;
  }
  .mp-bar,
  .mp-body,
  .mp-foot {
    padding-left: 14px;
    padding-right: 14px;
  }
}
</style>
