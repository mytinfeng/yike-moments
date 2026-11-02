<template>
  <div class="card">
    <div class="card-head">
      <h3>友情链接 <span class="hint">显示在前台「地球」按钮弹窗中</span></h3>
      <button class="a-btn primary" @click="openCreate"><i class="ri-add-line"></i>新增友链</button>
    </div>

    <div class="table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>链接</th>
            <th>联系邮箱</th>
            <th>排序</th>
            <th>显示</th>
            <th style="width: 160px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in list" :key="l.id">
            <td><strong>{{ l.name }}</strong></td>
            <td>
              <a :href="l.url" target="_blank" class="cell-muted" style="color: #2f80ed">{{ l.url }}</a>
            </td>
            <td><span class="cell-muted">{{ l.email || '—' }}</span></td>
            <td><span class="cell-muted">{{ l.sort }}</span></td>
            <td>
              <span class="badge" :class="l.visible ? 'green' : 'gray'">{{ l.visible ? '显示' : '隐藏' }}</span>
            </td>
            <td>
              <div class="row-actions">
                <button class="mini-btn" @click="openEdit(l)">编辑</button>
                <button class="mini-btn" @click="toggle(l)">{{ l.visible ? '隐藏' : '显示' }}</button>
                <button class="mini-btn danger" @click="remove(l)">删除</button>
              </div>
            </td>
          </tr>
          <tr v-if="!list.length">
            <td colspan="6"><div class="hint-block" style="text-align: center">还没有友链</div></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="modal.open" class="a-mask" @click.self="modal.open = false">
      <div class="a-modal" style="max-width: 460px">
        <div class="a-modal-head">
          <h3>{{ modal.mode === 'create' ? '新增友链' : '编辑友链' }}</h3>
          <button class="x" @click="modal.open = false"><i class="ri-close-line"></i></button>
        </div>
        <div class="a-modal-body">
          <div class="a-field">
            <label>名称 *</label>
            <input v-model="form.name" class="a-input" placeholder="站点名称" />
          </div>
          <div class="a-field">
            <label>链接 *</label>
            <input v-model="form.url" class="a-input" placeholder="https://example.com" />
          </div>
          <div class="a-field">
            <label>联系邮箱</label>
            <input v-model="form.email" class="a-input" placeholder="选填" />
          </div>
          <div class="a-row">
            <div class="a-field">
              <label>排序（越小越靠前）</label>
              <input v-model.number="form.sort" class="a-input" type="number" />
            </div>
            <div class="a-field">
              <label>是否显示</label>
              <select v-model="form.visible" class="a-select">
                <option :value="1">显示</option>
                <option :value="0">隐藏</option>
              </select>
            </div>
          </div>
        </div>
        <div class="a-modal-foot">
          <button class="a-btn" @click="modal.open = false">取消</button>
          <button class="a-btn primary" @click="save">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';
import { toast, confirmDialog } from '../../store.js';

const list = ref([]);
const modal = reactive({ open: false, mode: 'create' });
const form = reactive({ id: null, name: '', url: '', email: '', sort: 0, visible: 1 });

async function load() {
  list.value = await api.get('/api/admin/links');
}
function openCreate() {
  Object.assign(form, { id: null, name: '', url: '', email: '', sort: list.value.length + 1, visible: 1 });
  modal.mode = 'create';
  modal.open = true;
}
function openEdit(l) {
  Object.assign(form, l);
  modal.mode = 'edit';
  modal.open = true;
}
async function save() {
  if (!form.name.trim() || !form.url.trim()) return toast('名称和链接不能为空', 'error');
  try {
    if (modal.mode === 'create') await api.post('/api/admin/links', form);
    else await api.put(`/api/admin/links/${form.id}`, form);
    toast('已保存');
    modal.open = false;
    load();
  } catch (e) {
    toast(e.message, 'error');
  }
}
async function toggle(l) {
  await api.put(`/api/admin/links/${l.id}`, { visible: l.visible ? 0 : 1 });
  l.visible = l.visible ? 0 : 1;
}
async function remove(l) {
  const ok = await confirmDialog(`删除友链「${l.name}」？`, { title: '删除友链' });
  if (!ok) return;
  await api.del(`/api/admin/links/${l.id}`);
  toast('已删除');
  load();
}

onMounted(load);
</script>
