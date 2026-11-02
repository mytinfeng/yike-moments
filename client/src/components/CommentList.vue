<template>
  <div class="comment-list">
    <template v-for="c in visibleRoots" :key="c.id">
      <div class="comment-row" @click="$emit('reply', c)">
        <div class="comment-body">
          <span class="comment-name" :class="{ self: isSelf(c) }">{{ c.nickname }}</span>
          <span class="comment-colon">：</span>
          <span class="comment-text" v-html="renderText(c.content)"></span>
          <span v-if="detail && c.created_at" class="comment-time-mini">{{ timeAgo(c.created_at) }}</span>
        </div>
        <span v-if="canDelete(c)" class="comment-del" @click.stop="remove(c)">删除</span>
      </div>

      <div v-if="c.replies && c.replies.length" class="comment-replies">
        <div
          v-for="r in repliesOf(c)"
          :key="r.id"
          class="comment-row"
          @click="$emit('reply', r)"
        >
          <div class="comment-body">
            <span class="comment-name" :class="{ self: isSelf(r) }">{{ r.nickname }}</span>
            <span class="comment-reply-to">回复</span>
            <span class="comment-name">{{ r.to_nickname || c.nickname }}</span>
            <span class="comment-colon">：</span>
            <span class="comment-text" v-html="renderText(r.content)"></span>
            <span v-if="detail && r.created_at" class="comment-time-mini">{{ timeAgo(r.created_at) }}</span>
          </div>
          <span v-if="canDelete(r)" class="comment-del" @click.stop="remove(r)">删除</span>
        </div>
        <div v-if="!showAll && c.replies.length > 2" class="comment-more">
          还有 {{ c.replies.length - 2 }} 条回复
        </div>
      </div>
    </template>

    <div v-if="!comments.length" class="comment-empty">还没有评论，说点什么吧</div>
    <div
      v-else-if="!showAll && comments.length > visibleRoots.length"
      class="comment-more"
      @click="$emit('open-all')"
    >
      查看全部 {{ comments.length }} 条评论
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { api } from '../api.js';
import { store, toast, confirmDialog } from '../store.js';
import { renderText, timeAgo } from '../utils.js';

const props = defineProps({
  comments: { type: Array, default: () => [] },
  postId: { type: [Number, String], required: true },
  showAll: { type: Boolean, default: false },
  detail: { type: Boolean, default: false },
});
const emit = defineEmits(['reply', 'refresh', 'open-all', 'deleted']);

const visibleRoots = computed(() => (props.showAll ? props.comments : props.comments.slice(0, 3)));

function repliesOf(c) {
  return props.showAll ? c.replies : c.replies.slice(0, 2);
}
function isSelf(c) {
  return store.user && c.user_id === store.user.id;
}
function canDelete(c) {
  if (!store.user) return false;
  return store.user.role === 'admin' || c.user_id === store.user.id;
}
async function remove(c) {
  const ok = await confirmDialog('删除这条评论？删除后无法恢复。', { title: '删除评论' });
  if (!ok) return;
  try {
    await api.del(`/api/comments/${c.id}`);
    toast('已删除');
    emit('deleted', c.id);
    emit('refresh');
  } catch (e) {
    toast(e.message, 'error');
  }
}
</script>
