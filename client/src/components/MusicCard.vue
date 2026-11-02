<template>
  <div class="music-card" @click="play">
    <div class="music-card-cover-wrap">
      <img class="music-card-cover" :src="track.cover || store.settings.avatar" alt="" />
      <i :class="isCurrent && playing ? 'ri-pause-line' : 'ri-play-line'"></i>
    </div>
    <div class="music-card-info">
      <strong>{{ track.title || '未知歌曲' }}</strong>
      <span>{{ track.artist || '未知歌手' }}</span>
    </div>
    <i class="ri-play-circle-line"></i>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { store, playTrack } from '../store.js';

const props = defineProps({
  track: { type: Object, required: true },
});

const isCurrent = computed(() => store.player.track?.url === props.track.url);
const playing = computed(() => store.player.playing);

function play() {
  if (!props.track.url) return;
  playTrack(props.track);
}
</script>
