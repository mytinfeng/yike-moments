<template>
  <div class="kehua-main-head-headimg">
    <div class="kehua-main-head-headimg-tx">
      <h4>{{ store.settings.site_name }}</h4>
      <a href="javascript:void(0)">
        <img v-lazy.eager="store.settings.avatar" :alt="store.settings.site_name" />
      </a>
    </div>
    <div class="kehua-main-head-headimg-qm">
      <p :class="{ 'on-cover': false }">{{ store.settings.site_desc }}</p>
    </div>
  </div>
</template>

<script setup>
import { store } from '../store.js';
</script>
