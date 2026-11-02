<template>
  <div class="admin-root">
    <aside class="admin-sidebar">
      <div class="admin-logo">
        <div class="dot"><i class="ri-quill-pen-fill"></i></div>
        <div>
          <strong>朋友圈后台</strong>
          <span>Pengyouquan Admin</span>
        </div>
      </div>

      <nav class="admin-nav">
        <div class="admin-nav-group">内容</div>
        <router-link
          v-for="item in navMain"
          :key="item.to"
          :to="item.to"
          class="admin-nav-item"
          :class="{ active: isActive(item.to) }"
        >
          <i :class="item.icon"></i><span>{{ item.label }}</span>
        </router-link>

        <div class="admin-nav-group">系统</div>
        <router-link
          v-for="item in navSys"
          :key="item.to"
          :to="item.to"
          class="admin-nav-item"
          :class="{ active: isActive(item.to) }"
        >
          <i :class="item.icon"></i><span>{{ item.label }}</span>
        </router-link>
      </nav>

      <div class="admin-side-foot">
        <a href="/" target="_blank"><i class="ri-external-link-line"></i> 查看前台</a>
        <div style="margin-top: 6px">v1.0 · Node + SQLite</div>
      </div>
    </aside>

    <div class="admin-main">
      <header class="admin-topbar">
        <div>
          <h1>{{ pageTitle }}</h1>
          <div class="sub">{{ pageSub }}</div>
        </div>
        <div class="admin-user" @click.stop="menuOpen = !menuOpen">
          <img :src="store.user?.avatar || store.settings.avatar" alt="" />
          <div>
            <div class="name">{{ store.user?.nickname }}</div>
            <div class="role">管理员</div>
          </div>
          <i class="ri-arrow-down-s-line" style="color: #9aa4b2"></i>

          <div v-if="menuOpen" class="admin-dropdown">
            <div @click="$router.push('/admin/profile')"><i class="ri-user-settings-line"></i>账号设置</div>
            <div @click="openSite"><i class="ri-external-link-line"></i>打开前台</div>
            <div style="color: #c0392b" @click="doLogout"><i class="ri-logout-box-line"></i>退出登录</div>
          </div>
        </div>
      </header>

      <main class="admin-content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { store, logout, toast } from '../../store.js';

const route = useRoute();
const router = useRouter();
const menuOpen = ref(false);

const navMain = [
  { to: '/admin', label: '仪表盘', icon: 'ri-dashboard-3-line' },
  { to: '/admin/posts', label: '动态管理', icon: 'ri-quill-pen-line' },
  { to: '/admin/comments', label: '评论管理', icon: 'ri-chat-3-line' },
  { to: '/admin/stickers', label: '表情包', icon: 'ri-emotion-happy-line' },
  { to: '/admin/media', label: '媒体资源', icon: 'ri-folder-image-line' },
  { to: '/admin/users', label: '用户管理', icon: 'ri-group-line' },
  { to: '/admin/links', label: '友情链接', icon: 'ri-links-line' },
  { to: '/admin/federation', label: '友站联动', icon: 'ri-planet-line' },
];
const navSys = [
  { to: '/admin/settings', label: '站点设置', icon: 'ri-settings-3-line' },
  { to: '/admin/profile', label: '账号设置', icon: 'ri-user-settings-line' },
];

const titles = {
  'admin-dashboard': ['仪表盘', '站点数据总览与最近动态'],
  'admin-posts': ['动态管理', '发布、编辑、置顶与删除动态'],
  'admin-comments': ['评论管理', '审核、回复与删除评论'],
  'admin-stickers': ['表情包', '分组管理评论区的表情包，支持 GIF 动图'],
  'admin-media': ['媒体资源', '查看与管理已上传的图片、视频和音频'],
  'admin-users': ['用户管理', '账号、角色与状态管理'],
  'admin-links': ['友情链接', '前台友链模块的内容源'],
  'admin-federation': ['友站联动', '订阅好友站点的动态摘要，只读、只跳转'],
  'admin-settings': ['站点设置', '站点信息、封面、外观与功能开关'],
  'admin-profile': ['账号设置', '修改个人资料与登录密码'],
};

const pageTitle = computed(() => titles[route.name]?.[0] || '管理后台');
const pageSub = computed(() => titles[route.name]?.[1] || '');

function isActive(to) {
  if (to === '/admin') return route.path === '/admin';
  return route.path.startsWith(to);
}
function openSite() {
  window.open('/', '_blank');
}
async function doLogout() {
  await logout();
  toast('已退出登录');
  router.push('/admin/login');
}
function onDocClick() {
  menuOpen.value = false;
}
onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));
</script>
