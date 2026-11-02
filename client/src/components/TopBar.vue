<template>
  <div class="kehua-main-head-top" :class="{ scrolled }">
    <div class="kehua-main-head-top-left">
      <div class="kehua-main-head-top-left-s" @click.stop="onAvatarClick">
        <img v-if="store.user" class="kehua-avatar-mini" :src="avatar" alt="头像" />
        <i v-else class="ri-user-3-line" title="登录"></i>
      </div>
    </div>
    <div class="kehua-main-head-top-right">
      <div
        v-if="store.user"
        class="kehua-main-head-top-right-s"
        title="发布动态"
        @click="$router.push('/write')"
      >
        <i class="ri-camera-line"></i>
      </div>
      <div class="kehua-main-head-top-right-s" title="搜索" @click="store.searchOpen = true">
        <i class="ri-search-line"></i>
      </div>
      <div class="kehua-main-head-top-right-s" title="友情链接" @click="store.linksOpen = true">
        <i class="ri-earth-line"></i>
      </div>
      <div
        v-if="showFilter"
        ref="filterBtn"
        class="kehua-main-head-top-right-s"
        :class="{ on: !!month }"
        :title="month ? `已按时间筛选：${monthLabel(month)}` : '按时间筛选'"
        @click.stop="toggleFilter"
      >
        <i class="ri-calendar-2-line"></i>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="filterOpen"
      class="time-filter-pop"
      :style="filterStyle"
      @click.stop
    >
      <div class="time-filter-head">
        <div>
          <strong>按时间筛选</strong>
          <span>共 {{ totalCount }} 条动态</span>
        </div>
        <i class="ri-close-line" title="关闭" @click="filterOpen = false"></i>
      </div>
      <div class="time-filter-list">
        <div
          class="time-filter-item"
          :class="{ active: !month }"
          @click="pick('')"
        >
          <span>全部时间</span>
          <em>{{ totalCount }}</em>
        </div>
        <div v-if="!archiveLoaded" class="time-filter-empty">加载中…</div>
        <div
          v-for="m in months"
          :key="m.month"
          class="time-filter-item"
          :class="{ active: month === m.month }"
          @click="pick(m.month)"
        >
          <span>{{ monthLabel(m.month) }}</span>
          <em>{{ m.count }}</em>
        </div>
        <div v-if="archiveLoaded && !months.length" class="time-filter-empty">还没有动态</div>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div v-if="menuOpen" class="top-user-menu" :style="menuStyle" @click.stop>
      <div class="top-user-menu-head">
        <strong>{{ store.user.nickname }}</strong>
        <span>{{ store.user.role === 'admin' ? '管理员' : '友邻' }}</span>
      </div>
      <div class="top-user-menu-item" @click="go(`/author/${store.user.id}`)">
        <i class="ri-user-line"></i>我的主页
      </div>
      <div class="top-user-menu-item" @click="go('/write')"><i class="ri-camera-line"></i>发布动态</div>
      <div v-if="store.user.role === 'admin'" class="top-user-menu-item" @click="go('/admin')">
        <i class="ri-settings-3-line"></i>管理后台
      </div>
      <div class="top-user-menu-item danger" @click="doLogout"><i class="ri-logout-box-line"></i>退出登录</div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { store, logout, toast } from '../store.js';
import { monthLabel } from '../utils.js';

const props = defineProps({
  scrolled: { type: Boolean, default: false },
  month: { type: String, default: '' },
  showFilter: { type: Boolean, default: false },
});
const emit = defineEmits(['filter']);
const router = useRouter();
const menuOpen = ref(false);

const avatar = computed(() => store.user?.avatar || store.settings.avatar);
const menuStyle = ref({ top: '52px', left: '10px' });

/* ---------- 按时间筛选 ---------- */
const filterOpen = ref(false);
const filterBtn = ref(null);
const filterStyle = ref({ top: '52px', right: '12px' });
const months = ref([]);
const archiveLoaded = ref(false);
const totalCount = computed(() => months.value.reduce((n, m) => n + m.count, 0));

async function loadArchives() {
  if (archiveLoaded.value) return;
  try {
    months.value = await api.get('/api/posts/archives');
  } catch {
    months.value = [];
  } finally {
    archiveLoaded.value = true;
  }
}
function toggleFilter() {
  menuOpen.value = false;
  filterOpen.value = !filterOpen.value;
  if (!filterOpen.value) return;
  const rect = filterBtn.value?.getBoundingClientRect();
  if (rect) {
    filterStyle.value = {
      top: `${rect.bottom + 8}px`,
      right: `${Math.max(8, window.innerWidth - rect.right)}px`,
    };
  }
  loadArchives();
}
function pick(m) {
  filterOpen.value = false;
  if (m === props.month) return;
  emit('filter', m);
}
function onKey(e) {
  if (e.key === 'Escape') filterOpen.value = false;
}

function onAvatarClick() {
  if (!store.user) {
    store.loginOpen = true;
    return;
  }
  menuOpen.value = !menuOpen.value;
  filterOpen.value = false;
  if (menuOpen.value) {
    const btn = document.querySelector('.kehua-main-head-top-left-s');
    const rect = btn?.getBoundingClientRect();
    menuStyle.value = { top: `${(rect?.bottom || 52) + 6}px`, left: `${(rect?.left || 10)}px` };
  }
}
function go(path) {
  menuOpen.value = false;
  router.push(path);
}
async function doLogout() {
  menuOpen.value = false;
  await logout();
  toast('已退出登录');
}
function onDocClick() {
  menuOpen.value = false;
  filterOpen.value = false;
}
onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKey);
});
</script>
