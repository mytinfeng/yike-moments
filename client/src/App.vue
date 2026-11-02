<template>
  <router-view v-slot="{ Component }">
    <component :is="Component" />
  </router-view>

  <LoginModal />
  <GuestProfileModal v-if="!isAdminRoute" />
  <SearchModal />
  <LinksModal />
  <Lightbox />
  <ConfirmDialog />
  <MusicPlayer v-if="!isAdminRoute" />
  <ToastHost />
</template>

<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import LoginModal from './components/LoginModal.vue';
import GuestProfileModal from './components/GuestProfileModal.vue';
import SearchModal from './components/SearchModal.vue';
import LinksModal from './components/LinksModal.vue';
import Lightbox from './components/Lightbox.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import MusicPlayer from './components/MusicPlayer.vue';
import ToastHost from './components/ToastHost.vue';

const route = useRoute();
const isAdminRoute = computed(() => route.path.startsWith('/admin'));
</script>
