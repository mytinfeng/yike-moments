<template>
  <div class="card">
    <div class="card-head">
      <h3>用户列表 <span class="hint">共 {{ list.length }} 人</span></h3>
      <div class="filter-bar">
        <input v-model="q" class="a-input" placeholder="搜索用户名 / 邮箱 / 昵称" @keyup.enter="load" />
        <button class="a-btn" @click="load"><i class="ri-search-line"></i>查询</button>
        <button class="a-btn primary" @click="openCreate"><i class="ri-user-add-line"></i>新建用户</button>
      </div>
    </div>

    <div class="table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th>用户</th>
            <th>邮箱</th>
            <th>角色</th>
            <th>状态</th>
            <th>动态 / 评论</th>
            <th>注册时间</th>
            <th style="width: 180px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in list" :key="u.id">
            <td>
              <div class="cell-main">
                <img class="cell-thumb" style="border-radius: 50%; width: 34px; height: 34px" :src="u.avatar || store.settings.avatar" alt="" />
                <div class="cell-text">
                  <strong>{{ u.nickname }}</strong>
                  <span>@{{ u.username }}</span>
                </div>
              </div>
            </td>
            <td><span class="cell-muted">{{ u.email }}</span></td>
            <td>
              <span class="badge" :class="u.role === 'admin' ? 'blue' : 'gray'">
                {{ u.role === 'admin' ? '管理员' : '普通用户' }}
              </span>
            </td>
            <td>
              <span class="badge" :class="u.status === 'active' ? 'green' : 'red'">
                {{ u.status === 'active' ? '正常' : '已禁用' }}
              </span>
            </td>
            <td><span class="cell-muted">{{ u.post_count }} / {{ u.comment_count }}</span></td>
            <td><span class="cell-muted">{{ u.created_at?.slice(0, 10) }}</span></td>
            <td>
              <div class="row-actions">
                <button class="mini-btn" @click="openEdit(u)">编辑</button>
                <button class="mini-btn" :disabled="u.id === store.user?.id" @click="toggleBan(u)">
                  {{ u.status === 'active' ? '禁用' : '启用' }}
                </button>
                <button class="mini-btn danger" :disabled="u.id === store.user?.id" @click="remove(u)">删除</button>
              </div>
            </td>
          </tr>
          <tr v-if="!list.length">
            <td colspan="7"><div class="hint-block" style="text-align: center">没有匹配的用户</div></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="modal.open" class="a-mask" @click.self="modal.open = false">
      <div class="a-modal">
        <div class="a-modal-head">
          <h3>{{ modal.mode === 'create' ? '新建用户' : `编辑用户 #${form.id}` }}</h3>
          <button class="x" @click="modal.open = false"><i class="ri-close-line"></i></button>
        </div>
        <div class="a-modal-body">
          <div v-if="modal.mode === 'create'" class="a-row">
            <div class="a-field">
              <label>用户名 *</label>
              <input v-model="form.username" class="a-input" placeholder="登录账号" />
            </div>
            <div class="a-field">
              <label>初始密码 *</label>
              <input v-model="form.password" class="a-input" placeholder="至少 6 位" />
            </div>
          </div>
          <div class="a-field">
            <label>昵称</label>
            <input v-model="form.nickname" class="a-input" placeholder="前台显示的名字" />
          </div>
          <div class="a-field">
            <label>邮箱</label>
            <input v-model="form.email" class="a-input" placeholder="用于登录与通知" />
          </div>
          <div class="a-field">
            <label>头像地址</label>
            <input v-model="form.avatar" class="a-input" placeholder="/uploads/… 或 https://…" />
          </div>
          <div class="a-field">
            <label>个人简介</label>
            <textarea v-model="form.bio" class="a-textarea" style="min-height: 70px" maxlength="120"></textarea>
          </div>
          <div class="a-row">
            <div class="a-field">
              <label>角色</label>
              <select v-model="form.role" class="a-select">
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </div>
            <div class="a-field">
              <label>状态</label>
              <select v-model="form.status" class="a-select">
                <option value="active">正常</option>
                <option value="banned">禁用</option>
              </select>
            </div>
          </div>
          <div v-if="modal.mode === 'edit'" class="a-field">
            <label>重置密码</label>
            <input v-model="form.newPassword" class="a-input" placeholder="留空表示不修改" />
          </div>
        </div>
        <div class="a-modal-foot">
          <button class="a-btn" @click="modal.open = false">取消</button>
          <button class="a-btn primary" :disabled="saving" @click="save">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';
import { store, toast, confirmDialog } from '../../store.js';

const list = ref([]);
const q = ref('');
const saving = ref(false);
const modal = reactive({ open: false, mode: 'create' });
const form = reactive({
  id: null,
  username: '',
  password: '',
  newPassword: '',
  nickname: '',
  email: '',
  avatar: '',
  bio: '',
  role: 'user',
  status: 'active',
});

async function load() {
  const qs = q.value.trim() ? `?q=${encodeURIComponent(q.value.trim())}` : '';
  list.value = await api.get(`/api/admin/users${qs}`);
}

function openCreate() {
  Object.assign(form, {
    id: null,
    username: '',
    password: '',
    newPassword: '',
    nickname: '',
    email: '',
    avatar: '',
    bio: '',
    role: 'user',
    status: 'active',
  });
  modal.mode = 'create';
  modal.open = true;
}
function openEdit(u) {
  Object.assign(form, {
    id: u.id,
    username: u.username,
    password: '',
    newPassword: '',
    nickname: u.nickname,
    email: u.email,
    avatar: u.avatar,
    bio: u.bio,
    role: u.role,
    status: u.status,
  });
  modal.mode = 'edit';
  modal.open = true;
}

async function save() {
  saving.value = true;
  try {
    if (modal.mode === 'create') {
      if (!form.username.trim()) throw new Error('请填写用户名');
      if (form.password.length < 6) throw new Error('密码至少 6 位');
      await api.post('/api/admin/users', {
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
        nickname: form.nickname.trim() || form.username.trim(),
        avatar: form.avatar,
        bio: form.bio,
        role: form.role,
      });
      toast('用户已创建');
    } else {
      await api.put(`/api/admin/users/${form.id}`, {
        nickname: form.nickname,
        email: form.email,
        avatar: form.avatar,
        bio: form.bio,
        role: form.role,
        status: form.status,
        password: form.newPassword || undefined,
      });
      toast('已保存');
    }
    modal.open = false;
    load();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    saving.value = false;
  }
}

async function toggleBan(u) {
  try {
    await api.put(`/api/admin/users/${u.id}`, { status: u.status === 'active' ? 'banned' : 'active' });
    u.status = u.status === 'active' ? 'banned' : 'active';
    toast(u.status === 'active' ? '已启用' : '已禁用');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function remove(u) {
  const ok = await confirmDialog(
    `确定删除用户「${u.nickname}」？该用户的动态、评论会一并删除，且不可恢复。`,
    { title: '删除用户' }
  );
  if (!ok) return;
  try {
    await api.del(`/api/admin/users/${u.id}`);
    toast('已删除');
    load();
  } catch (e) {
    toast(e.message, 'error');
  }
}

onMounted(load);
</script>
