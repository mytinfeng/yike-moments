<template>
  <div class="card">
    <div class="card-head">
      <h3>
        表情包
        <span class="hint">共 {{ total }} 个 · 前台评论区的表情面板由这里的「显示中」分组组成</span>
      </h3>
      <div class="filter-bar">
        <span class="upload-tip">支持 GIF 动图 · 单个 ≤ {{ maxFileSizeMB }}MB</span>
        <button class="a-btn primary" @click="openCreate"><i class="ri-add-line"></i>新建分组</button>
      </div>
    </div>

    <div class="stk-layout">
      <!-- 左：分组 -->
      <aside class="stk-groups">
        <div class="stk-groups-head">
          <span>分组 {{ groups.length }}</span>
          <i class="ri-refresh-line" title="刷新" @click="load"></i>
        </div>
        <div class="stk-group-list">
          <div
            v-for="g in groups"
            :key="g.id"
            class="stk-group"
            :class="{ active: g.id === activeId }"
            @click="activeId = g.id"
          >
            <div class="stk-group-main">
              <strong :title="g.name">{{ g.name }}</strong>
              <span class="stk-group-meta">
                {{ g.stickers.length }} 个
                <em v-if="!g.visible" class="off">已隐藏</em>
              </span>
            </div>
            <div class="stk-group-ops" @click.stop>
              <i class="ri-edit-line" title="编辑分组" @click="openEdit(g)"></i>
              <i
                :class="g.visible ? 'ri-eye-off-line' : 'ri-eye-line'"
                :title="g.visible ? '前台隐藏' : '前台显示'"
                @click="toggleVisible(g)"
              ></i>
              <i class="ri-delete-bin-line" title="删除分组" @click="removeGroup(g)"></i>
            </div>
          </div>
          <div v-if="loadError" class="hint-block" style="text-align: center; margin: 10px; color: #c0392b">
            {{ loadError }}
          </div>
          <div v-else-if="!groups.length" class="hint-block" style="text-align: center; margin: 10px">
            还没有分组
          </div>
        </div>
      </aside>

      <!-- 右：表情 -->
      <section
        class="stk-main"
        :class="{ dragging }"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <template v-if="active">
          <div class="stk-bar">
            <div class="stk-bar-title">
              <strong>{{ active.name }}</strong>
              <span class="cell-muted">
                {{ active.stickers.length }} 个表情
                <template v-if="!active.visible"> · 当前前台不显示</template>
              </span>
            </div>
            <div class="row-actions">
              <label class="a-btn primary" :class="{ disabled: uploading }">
                <i class="ri-upload-cloud-2-line"></i>
                {{ uploading ? `上传中 ${progress.done}/${progress.total}` : '上传表情' }}
                <input
                  ref="fileRef"
                  type="file"
                  multiple
                  accept="image/gif,image/png,image/jpeg,image/webp"
                  style="display: none"
                  @change="onPick"
                />
              </label>
            </div>
          </div>

          <div v-if="active.stickers.length" class="stk-grid">
            <div v-for="s in active.stickers" :key="s.id" class="stk-cell" :title="s.name || '表情'">
              <img :src="s.url" :alt="s.name || '表情'" loading="lazy" @dblclick="openRename(s)" />
              <button class="stk-edit" title="改名称" @click.stop="openRename(s)">
                <i class="ri-pencil-line"></i>
              </button>
              <button class="stk-del" title="删除" @click.stop="removeSticker(s)">
                <i class="ri-close-line"></i>
              </button>
            </div>
          </div>
          <div v-else class="stk-empty">
            <i class="ri-emotion-laugh-line"></i>
            <p>这个分组还是空的</p>
            <span>点右上角「上传表情」，或把图片直接拖到这里</span>
          </div>

          <div class="stk-drop-hint">把图片拖进这个区域也可以上传（一次最多 30 张）· 鼠标移到表情上可改名</div>
        </template>

        <div v-else class="stk-empty" style="min-height: 320px">
          <i class="ri-folder-add-line"></i>
          <p>先创建一个分组</p>
          <span>分组用来归类表情，比如「猫猫」「日常」「梗图」</span>
          <button class="a-btn primary" style="margin-top: 12px" @click="openCreate">新建分组</button>
        </div>

        <div v-if="dragging" class="stk-drop-mask"><span>松手即可上传到「{{ active?.name }}」</span></div>
      </section>
    </div>

    <!-- 分组弹窗 -->
    <div v-if="modal.open" class="a-mask" @click.self="modal.open = false">
      <div class="a-modal" style="max-width: 420px">
        <div class="a-modal-head">
          <h3>{{ modal.mode === 'create' ? '新建分组' : '编辑分组' }}</h3>
          <button class="x" @click="modal.open = false"><i class="ri-close-line"></i></button>
        </div>
        <div class="a-modal-body">
          <div class="a-field">
            <label>分组名称 *</label>
            <input
              v-model="form.name"
              class="a-input"
              maxlength="16"
              placeholder="例如：猫猫 / 日常 / 梗图"
              @keyup.enter="saveGroup"
            />
          </div>
          <div class="a-row">
            <div class="a-field">
              <label>排序（越小越靠前）</label>
              <input v-model.number="form.sort" class="a-input" type="number" />
            </div>
            <div class="a-field">
              <label>前台是否显示</label>
              <select v-model="form.visible" class="a-select">
                <option :value="1">显示</option>
                <option :value="0">隐藏</option>
              </select>
            </div>
          </div>
          <div class="a-field">
            <div class="desc">隐藏只是不在评论区的表情面板里出现，历史评论已经用过的表情照常显示。</div>
          </div>
        </div>
        <div class="a-modal-foot">
          <button class="a-btn" @click="modal.open = false">取消</button>
          <button class="a-btn primary" @click="saveGroup">保存</button>
        </div>
      </div>
    </div>

    <!-- 改名弹窗 -->
    <div v-if="rename.open" class="a-mask" @click.self="rename.open = false">
      <div class="a-modal" style="max-width: 420px">
        <div class="a-modal-head">
          <h3>表情名称</h3>
          <button class="x" @click="rename.open = false"><i class="ri-close-line"></i></button>
        </div>
        <div class="a-modal-body">
          <div class="stk-preview">
            <img :src="rename.url" alt="" />
          </div>
          <div class="a-field">
            <label>名称 *</label>
            <input
              v-model="rename.name"
              class="a-input"
              maxlength="20"
              placeholder="例如：猫猫点赞 / 哭笑不得"
              @keyup.enter="saveRename"
            />
          </div>
          <div class="a-field">
            <div class="desc">
              前台评论区悬停时显示这个名字，也是图片的 alt 文本。不改就是上传时的文件名。
            </div>
          </div>
        </div>
        <div class="a-modal-foot">
          <button class="a-btn" @click="rename.open = false">取消</button>
          <button class="a-btn primary" @click="saveRename">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';
import { toast, confirmDialog } from '../../store.js';

const groups = ref([]);
const activeId = ref(null);
const loadError = ref('');
const total = ref(0);
const uploading = ref(false);
const progress = reactive({ done: 0, total: 0 });
const dragging = ref(false);
const fileRef = ref(null);
const maxFileSize = ref(4 * 1024 * 1024);
const maxFiles = ref(30);

const modal = reactive({ open: false, mode: 'create' });
const form = reactive({ id: null, name: '', sort: 0, visible: 1 });
/* 单个表情改名 */
const rename = reactive({ open: false, id: null, name: '', url: '' });

const maxFileSizeMB = computed(() => Math.round(maxFileSize.value / 1024 / 1024));
const active = computed(() => groups.value.find((g) => g.id === activeId.value) || null);

async function load() {
  try {
    const data = await api.get('/api/admin/stickers');
    groups.value = data.groups || [];
    total.value = data.total || 0;
    if (data.maxFileSize) maxFileSize.value = data.maxFileSize;
    if (data.maxFiles) maxFiles.value = data.maxFiles;
    if (!groups.value.some((g) => g.id === activeId.value)) {
      activeId.value = groups.value[0]?.id ?? null;
    }
    loadError.value = '';
  } catch (e) {
    loadError.value =
      e.status === 404
        ? '接口不存在，请重启后端服务（npm start）后再刷新本页'
        : `加载失败：${e.message}`;
  }
}

/* ---------- 分组 ---------- */
function openCreate() {
  Object.assign(form, { id: null, name: '', sort: groups.value.length + 1, visible: 1 });
  modal.mode = 'create';
  modal.open = true;
}
function openEdit(g) {
  Object.assign(form, { id: g.id, name: g.name, sort: g.sort, visible: g.visible ? 1 : 0 });
  modal.mode = 'edit';
  modal.open = true;
}
async function saveGroup() {
  const name = form.name.trim();
  if (!name) return toast('分组名称不能为空', 'error');
  try {
    if (modal.mode === 'create') {
      const g = await api.post('/api/admin/stickers/groups', {
        name,
        sort: form.sort,
        visible: form.visible,
      });
      groups.value.push({ ...g, stickers: [] });
      activeId.value = g.id;
    } else {
      const g = await api.put(`/api/admin/stickers/groups/${form.id}`, {
        name,
        sort: form.sort,
        visible: form.visible,
      });
      const i = groups.value.findIndex((x) => x.id === g.id);
      if (i > -1) groups.value[i] = { ...g, stickers: groups.value[i].stickers };
      groups.value.sort((a, b) => a.sort - b.sort || a.id - b.id);
    }
    toast('已保存');
    modal.open = false;
    load();
  } catch (e) {
    toast(e.message, 'error');
  }
}
async function toggleVisible(g) {
  try {
    await api.put(`/api/admin/stickers/groups/${g.id}`, { visible: g.visible ? 0 : 1 });
    g.visible = !g.visible;
    toast(g.visible ? '已在前台显示' : '已在前台隐藏');
  } catch (e) {
    toast(e.message, 'error');
  }
}
async function removeGroup(g) {
  const ok = await confirmDialog(
    `删除分组「${g.name}」？组内 ${g.stickers.length} 个表情会一起删除，历史评论里的这些表情将不再显示。`,
    { title: '删除分组' }
  );
  if (!ok) return;
  try {
    await api.del(`/api/admin/stickers/groups/${g.id}`);
    toast('已删除');
    if (activeId.value === g.id) activeId.value = null;
    load();
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ---------- 上传 ---------- */
function onPick(e) {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  uploadFiles(files);
}
function onDrop(e) {
  dragging.value = false;
  if (!active.value) return toast('请先选择分组', 'error');
  uploadFiles([...(e.dataTransfer?.files || [])]);
}

async function uploadFiles(files) {
  if (!active.value) return toast('请先选择分组', 'error');
  if (uploading.value) return toast('还在上传，稍等…', 'error');

  const imgs = [];
  let tooBig = 0;
  for (const f of files) {
    if (!/^image\/(gif|png|jpeg|webp)$/i.test(f.type)) continue;
    if (f.size > maxFileSize.value) {
      tooBig += 1;
      continue;
    }
    imgs.push(f);
  }
  if (tooBig) toast(`有 ${tooBig} 张超过 ${maxFileSizeMB.value}MB，已跳过`, 'error');
  if (!imgs.length) {
    return toast('请选择 png / jpg / gif / webp 图片', 'error');
  }
  if (imgs.length > maxFiles.value) {
    return toast(`一次最多上传 ${maxFiles.value} 张`, 'error');
  }

  uploading.value = true;
  progress.done = 0;
  progress.total = imgs.length;
  let added = 0;
  let skipped = 0;
  const failed = [];
  try {
    // 分小批上传：进度看得见，单次请求也不会太大
    for (let i = 0; i < imgs.length; i += 10) {
      const chunk = imgs.slice(i, i + 10);
      try {
        const r = await api.uploadTo(
          `/api/admin/stickers/upload?group_id=${active.value.id}`,
          chunk,
          'files'
        );
        added += r.added?.length || 0;
        skipped += r.skipped?.length || 0;
        for (const f of r.failed || []) failed.push(`${f.name}：${f.reason}`);
      } catch (e) {
        for (const f of chunk) failed.push(`${f.name}：${e.message}`);
      }
      progress.done += chunk.length;
    }
    if (added) toast(`已添加 ${added} 个表情${skipped ? `，${skipped} 个已存在` : ''}`);
    if (skipped && !added) toast(`${skipped} 个表情已经在分组里了`);
    if (failed.length) toast(`${failed.length} 个失败：${failed[0]}`, 'error');
    await load();
  } finally {
    uploading.value = false;
    progress.done = 0;
    progress.total = 0;
  }
}

/* ---------- 改名 ---------- */
function openRename(s) {
  Object.assign(rename, { open: true, id: s.id, name: s.name || '', url: s.url });
}
async function saveRename() {
  const name = rename.name.trim();
  if (!name) return toast('名称不能为空', 'error');
  try {
    const r = await api.put(`/api/admin/stickers/items/${rename.id}`, { name });
    for (const g of groups.value) {
      const hit = g.stickers.find((x) => x.id === rename.id);
      if (hit) hit.name = r.name || name;
    }
    rename.open = false;
    toast('已保存');
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ---------- 删除表情 ---------- */
async function removeSticker(s) {
  const ok = await confirmDialog('删除这个表情？历史评论里用到它的地方将不再显示。', {
    title: '删除表情',
  });
  if (!ok) return;
  try {
    await api.del(`/api/admin/stickers/items/${s.id}`);
    active.value.stickers = active.value.stickers.filter((x) => x.id !== s.id);
    total.value = Math.max(0, total.value - 1);
    toast('已删除');
  } catch (e) {
    toast(e.message, 'error');
  }
}

onMounted(load);
</script>

<style scoped>
.stk-layout {
  display: grid;
  grid-template-columns: 268px minmax(0, 1fr);
  gap: 0;
  min-height: 460px;
}
.stk-groups {
  border-right: 1px solid var(--a-line);
  padding: 12px;
  background: #fcfcfd;
  border-radius: 0 0 0 12px;
}
.stk-groups-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--a-sub);
  padding: 2px 6px 10px;
}
.stk-groups-head i {
  cursor: pointer;
  font-size: 14px;
}
.stk-groups-head i:hover {
  color: var(--a-primary);
}
.stk-group-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 520px;
  overflow-y: auto;
}
.stk-group {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.15s, border-color 0.15s;
}
.stk-group:hover {
  background: #f2f4f7;
}
.stk-group.active {
  background: #eafaf1;
  border-color: rgba(9, 195, 98, 0.35);
}
.stk-group-main {
  min-width: 0;
}
.stk-group-main strong {
  display: block;
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 140px;
}
.stk-group-meta {
  font-size: 11.5px;
  color: var(--a-sub);
}
.stk-group-meta .off {
  font-style: normal;
  color: #c0392b;
  margin-left: 6px;
}
.stk-group-ops {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s;
}
.stk-group:hover .stk-group-ops,
.stk-group.active .stk-group-ops {
  opacity: 1;
}
.stk-group-ops i {
  font-size: 14px;
  color: var(--a-sub);
  padding: 3px;
  border-radius: 5px;
  cursor: pointer;
}
.stk-group-ops i:hover {
  color: var(--a-primary);
  background: #fff;
}
.stk-group-ops i.ri-delete-bin-line:hover {
  color: #c0392b;
}

.stk-main {
  position: relative;
  padding: 14px 16px 18px;
  min-width: 0;
}
.stk-main.dragging {
  background: #f4fdf8;
}
.stk-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--a-line);
  margin-bottom: 14px;
}
.stk-bar-title strong {
  font-size: 14px;
  margin-right: 8px;
}
.a-btn.disabled {
  opacity: 0.6;
  pointer-events: none;
}
.stk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 96px);
  justify-content: start;
  gap: 10px;
}
.stk-cell {
  position: relative;
  width: 96px;
  height: 96px;
  border: 1px solid var(--a-line);
  border-radius: 10px;
  background: #fafbfc;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
}
.stk-cell:hover {
  border-color: rgba(9, 195, 98, 0.5);
  background: #fff;
}
.stk-cell img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.stk-del {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  border: 1px solid var(--a-line);
  color: #9aa4b2;
  display: none;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(16, 24, 40, 0.12);
}
.stk-cell:hover .stk-del {
  display: flex;
}
.stk-del:hover {
  color: #fff;
  background: #e04b4b;
  border-color: #e04b4b;
}
.stk-edit {
  position: absolute;
  top: -6px;
  left: -6px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  border: 1px solid var(--a-line);
  color: #9aa4b2;
  display: none;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(16, 24, 40, 0.12);
}
.stk-cell:hover .stk-edit {
  display: flex;
}
.stk-edit:hover {
  color: #fff;
  background: var(--a-primary);
  border-color: var(--a-primary);
}
.stk-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 120px;
  margin-bottom: 14px;
  border: 1px solid var(--a-line);
  border-radius: 10px;
  background: #fafbfc;
}
.stk-preview img {
  max-width: 100%;
  max-height: 100px;
  object-fit: contain;
}
.stk-empty {
  min-height: 260px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--a-sub);
  font-size: 12.5px;
  gap: 4px;
}
.stk-empty i {
  font-size: 34px;
  color: #ccd3de;
}
.stk-empty p {
  font-size: 13.5px;
  color: var(--a-text);
  margin: 4px 0 0;
}
.stk-drop-hint {
  margin-top: 16px;
  font-size: 11.5px;
  color: #a6b0bf;
  text-align: center;
}
.stk-drop-mask {
  position: absolute;
  inset: 8px;
  border: 2px dashed var(--a-primary);
  border-radius: 12px;
  background: rgba(9, 195, 98, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--a-primary-dark);
  pointer-events: none;
}
.upload-tip {
  font-size: 11.5px;
  color: var(--a-sub);
}
</style>
