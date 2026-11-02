<template>
  <div class="card">
    <div class="card-head">
      <h3>
        媒体资源
        <span class="hint">
          共 {{ stats.all }} 个 · 占用 {{ humanSize(stats.totalSize) }} · 其中
          <b :style="stats.orphan ? 'color:#b26a00' : ''">{{ stats.orphan }}</b> 个没被使用
        </span>
      </h3>
      <div class="filter-bar">
        <button class="a-btn" :disabled="loading" @click="load">
          <i :class="loading ? 'ri-loader-4-line spinning' : 'ri-refresh-line'"></i>刷新
        </button>
      </div>
    </div>

    <div class="md-filters">
      <div class="tabs">
        <button
          v-for="t in typeTabs"
          :key="t.value"
          :class="{ active: type === t.value }"
          @click="setType(t.value)"
        >
          {{ t.label }}<i v-if="t.count !== undefined" class="tab-n">{{ t.count }}</i>
        </button>
      </div>
      <div class="filter-bar">
        <input
          v-model="keyword"
          class="a-input"
          placeholder="搜文件名 / 目录，如 2026 或 cover"
          @keyup.enter="reload(1)"
        />
        <select v-model="used" class="a-select" @change="reload(1)">
          <option value="all">全部</option>
          <option value="used">仅看已引用</option>
          <option value="orphan">仅看未使用</option>
        </select>
        <button class="a-btn" @click="reload(1)">筛选</button>
      </div>
    </div>

    <div v-if="errorMsg" class="hint-block" style="padding: 16px 20px; color: #c0392b">
      {{ errorMsg }}
    </div>

    <div v-else-if="!items.length && !loading" class="md-empty">
      <i class="ri-folder-open-line"></i>
      <p>{{ keyword || used !== 'all' || type !== 'all' ? '没有符合条件的文件' : '还没有上传过文件' }}</p>
      <span>在发布动态、上传封面或表情包时上传的文件都会出现在这里</span>
    </div>

    <div v-else class="md-grid">
      <div v-for="m in items" :key="m.url" class="md-cell" @click="openPreview(m)">
        <div class="md-thumb">
          <img
            v-if="m.kind === 'image' && !m.broken"
            :src="m.url"
            :alt="m.name"
            loading="lazy"
            @error="m.broken = true"
          />
          <i v-else-if="m.broken" class="ri-image-line"></i>
          <video v-else-if="m.kind === 'video'" :src="m.url" preload="metadata" muted></video>
          <i v-else :class="iconOf(m.kind)"></i>
          <span class="md-tag" :class="m.usedCount ? 'used' : 'orphan'">
            {{ m.usedCount ? `引用 ${m.usedCount}` : '未使用' }}
          </span>
          <button class="md-del" title="删除" @click.stop="remove(m)">
            <i class="ri-delete-bin-line"></i>
          </button>
        </div>
        <div class="md-name" :title="m.name">{{ m.name }}</div>
        <div class="md-meta">{{ humanSize(m.size) }} · {{ shortDate(m.mtime) }}</div>
      </div>
    </div>

    <div v-if="maxPage > 1" class="pager">
      <span>共 {{ total }} 个 · 第 {{ page }}/{{ maxPage }} 页</span>
      <button :disabled="page <= 1" @click="reload(page - 1)">上一页</button>
      <button v-for="p in pageList" :key="p" :class="{ on: p === page }" @click="reload(p)">
        {{ p }}
      </button>
      <button :disabled="page >= maxPage" @click="reload(page + 1)">下一页</button>
    </div>

    <!-- 预览 -->
    <div v-if="cur" class="a-mask" @click.self="cur = null">
      <div class="a-modal" style="max-width: 680px">
        <div class="a-modal-head">
          <h3 style="font-size: 14px">{{ cur.name }}</h3>
          <button class="x" @click="cur = null"><i class="ri-close-line"></i></button>
        </div>
        <div class="a-modal-body">
          <div class="md-preview">
            <img
              v-if="cur.kind === 'image' && !previewBroken"
              :src="cur.url"
              :alt="cur.name"
              @error="previewBroken = true"
            />
            <i v-else-if="previewBroken" :class="iconOf(cur.kind)"></i>
            <video v-else-if="cur.kind === 'video'" :src="cur.url" controls playsinline></video>
            <audio v-else-if="cur.kind === 'audio'" :src="cur.url" controls></audio>
            <i v-else :class="iconOf(cur.kind)"></i>
          </div>

          <div class="md-info">
            <div><span>地址</span><code>{{ cur.url }}</code></div>
            <div><span>大小</span>{{ humanSize(cur.size) }}</div>
            <div><span>上传时间</span>{{ shortDate(cur.mtime) }}</div>
            <div><span>目录</span>{{ cur.dir || 'uploads 根目录' }}</div>
            <div>
              <span>被使用</span>
              <template v-if="cur.refs.length">
                <a
                  v-for="(r, i) in cur.refs"
                  :key="i"
                  class="md-ref"
                  @click="goRef(r)"
                >
                  {{ r.label }}
                </a>
              </template>
              <em v-else class="md-unused">没有地方在用，可以放心删除</em>
            </div>
          </div>
        </div>
        <div class="a-modal-foot">
          <button class="a-btn" @click="copyUrl(cur)"><i class="ri-file-copy-line"></i>复制地址</button>
          <button class="a-btn" @click="cur = null">关闭</button>
          <button class="a-btn danger" @click="remove(cur)">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../api.js';
import { toast, confirmDialog } from '../../store.js';

const router = useRouter();

const items = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(24);
const maxPage = ref(1);
const stats = ref({ all: 0, image: 0, video: 0, audio: 0, other: 0, orphan: 0, totalSize: 0 });
const type = ref('all');
const used = ref('all');
const keyword = ref('');
const loading = ref(false);
const errorMsg = ref('');
const cur = ref(null);
const previewBroken = ref(false);

const typeTabs = computed(() => [
  { value: 'all', label: '全部', count: stats.value.all },
  { value: 'image', label: '图片', count: stats.value.image },
  { value: 'video', label: '视频', count: stats.value.video },
  { value: 'audio', label: '音频', count: stats.value.audio },
]);

const pageList = computed(() => {
  const out = [];
  const start = Math.max(1, page.value - 2);
  const end = Math.min(maxPage.value, start + 4);
  for (let i = start; i <= end; i += 1) out.push(i);
  return out;
});

function iconOf(kind) {
  if (kind === 'video') return 'ri-video-line';
  if (kind === 'audio') return 'ri-music-2-line';
  if (kind === 'image') return 'ri-image-line';
  return 'ri-file-3-line';
}

function humanSize(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

function shortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function load() {
  loading.value = true;
  errorMsg.value = '';
  try {
    const qs = new URLSearchParams({
      type: type.value,
      used: used.value,
      q: keyword.value.trim(),
      page: String(page.value),
      pageSize: String(pageSize.value),
    });
    const data = await api.get(`/api/admin/media?${qs}`);
    items.value = data.items || [];
    total.value = data.total || 0;
    page.value = data.page || 1;
    maxPage.value = data.maxPage || 1;
    stats.value = data.stats || stats.value;
  } catch (e) {
    errorMsg.value =
      e.status === 404
        ? '接口不存在，请重启后端服务（npm start）后再刷新本页'
        : `加载失败：${e.message}`;
  } finally {
    loading.value = false;
  }
}

function reload(p = 1) {
  page.value = p;
  load();
}
function setType(v) {
  type.value = v;
  reload(1);
}

function openPreview(m) {
  previewBroken.value = false;
  cur.value = m;
}

function goRef(r) {
  if (r.type === 'post') router.push(`/post/${r.id}`);
  else if (r.type === 'sticker') router.push('/admin/stickers');
  else if (r.type === 'user') router.push('/admin/users');
  else router.push('/admin/settings');
}

async function copyUrl(m) {
  try {
    const abs = new URL(m.url, location.origin).href;
    await navigator.clipboard.writeText(abs);
    toast('地址已复制');
  } catch {
    toast('复制失败，请手动选中复制', 'error');
  }
}

async function remove(m) {
  if (m.usedCount) {
    toast(`这个文件正在被使用（${m.refs[0]?.label || '别处'}），不能删除`, 'error');
    return;
  }
  const ok = await confirmDialog(`删除「${m.name}」？文件会从磁盘上移除，删了找不回来。`, {
    title: '删除文件',
  });
  if (!ok) return;
  try {
    const r = await api.del('/api/admin/media', { urls: [m.url] });
    if (r.deleted?.length) {
      toast('已删除');
      cur.value = null;
      load();
    } else {
      toast(r.skipped?.[0]?.reason || '删除失败', 'error');
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

onMounted(load);
</script>

<style scoped>
.md-filters {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 20px;
  border-bottom: 1px solid var(--a-line);
}
.tab-n {
  font-style: normal;
  font-size: 11px;
  color: var(--a-sub);
  margin-left: 5px;
}
.tabs button.active .tab-n {
  color: var(--a-primary);
}
.md-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 14px;
  padding: 18px 20px;
}
.md-cell {
  position: relative;
  border: 1px solid var(--a-line);
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}
.md-cell:hover {
  border-color: rgba(9, 195, 98, 0.5);
  box-shadow: 0 4px 14px rgba(16, 24, 40, 0.08);
  transform: translateY(-1px);
}
.md-thumb {
  position: relative;
  height: 118px;
  background: #f6f8fa;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.md-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.md-thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #111;
}
.md-thumb > i {
  font-size: 34px;
  color: #b6c0ce;
}
.md-tag {
  position: absolute;
  left: 6px;
  top: 6px;
  font-size: 10.5px;
  line-height: 1;
  padding: 4px 6px;
  border-radius: 5px;
  color: #fff;
  background: rgba(16, 24, 40, 0.55);
  backdrop-filter: blur(2px);
}
.md-tag.orphan {
  background: rgba(214, 137, 16, 0.9);
}
.md-del {
  position: absolute;
  right: 6px;
  top: 6px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  color: #7c8798;
  display: none;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  box-shadow: 0 1px 4px rgba(16, 24, 40, 0.18);
}
.md-cell:hover .md-del {
  display: flex;
}
.md-del:hover {
  color: #fff;
  background: #e04b4b;
}
.md-name {
  font-size: 12.5px;
  color: var(--a-text);
  padding: 7px 9px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.md-meta {
  font-size: 11px;
  color: var(--a-sub);
  padding: 2px 9px 8px;
}
.md-empty {
  min-height: 260px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--a-sub);
  font-size: 12.5px;
}
.md-empty i {
  font-size: 36px;
  color: #ccd3de;
}
.md-empty p {
  font-size: 13.5px;
  color: var(--a-text);
  margin: 6px 0 0;
}
.md-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 180px;
  max-height: 360px;
  background: #f6f8fa;
  border: 1px solid var(--a-line);
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 14px;
}
.md-preview img {
  max-width: 100%;
  max-height: 340px;
  object-fit: contain;
}
.md-preview video {
  max-width: 100%;
  max-height: 340px;
}
.md-preview audio {
  width: 80%;
}
.md-preview > i {
  font-size: 40px;
  color: #b6c0ce;
}
.md-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12.5px;
  color: var(--a-text);
}
.md-info > div {
  display: flex;
  gap: 10px;
  align-items: baseline;
}
.md-info > div > span {
  flex: 0 0 66px;
  color: var(--a-sub);
  font-size: 12px;
}
.md-info code {
  font-size: 11.5px;
  background: #f4f6f9;
  padding: 2px 6px;
  border-radius: 5px;
  word-break: break-all;
}
.md-ref {
  display: inline-block;
  margin: 0 6px 4px 0;
  color: var(--a-primary-dark);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.md-unused {
  font-style: normal;
  color: #b26a00;
}
.spinning {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
