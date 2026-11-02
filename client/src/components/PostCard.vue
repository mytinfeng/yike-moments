<template>
  <div class="kehua-content">
    <div class="kehua-content-left">
      <img v-lazy.eager="post.avatar || store.settings.avatar" alt="头像" @click="goAuthor" />
    </div>

    <div class="kehua-content-right">
      <div class="kehua-content-right-head">
        <div class="kehua-content-right-head-title">
          <p @click="goAuthor">{{ post.nickname }}</p>
          <div class="title-badges">
            <div v-if="post.is_pinned" class="kehua-content-right-head-title-ad pin">置顶</div>
            <div v-if="post.is_ad" class="kehua-content-right-head-title-ad ad">广告</div>
          </div>
        </div>

        <div
          v-if="post.content"
          class="post-text"
          :class="{ collapsed: collapsible && !expanded }"
          v-html="renderText(post.content)"
        ></div>
        <span v-if="collapsible" class="post-more" @click="expanded = !expanded">
          {{ expanded ? '收起' : '全文' }}
        </span>

        <ImageGrid v-if="images.length" :images="images" @open="onOpenImage" />

        <div v-if="post.video" class="post-video">
          <video :src="post.video" controls playsinline preload="metadata"></video>
        </div>

        <MusicCard v-if="post.music && post.music.url" :track="post.music" />

        <LinkCard v-if="post.link && post.link.url" :link="post.link" />

        <a v-if="post.location" class="post-location" href="javascript:void(0)">
          <i class="ri-map-pin-line"></i>{{ post.location }}
        </a>

        <a v-if="post.ad_url" class="ad-link" :href="normalize(post.ad_url)" target="_blank" rel="noopener">
          <i class="ri-link"></i>{{ post.ad_url }}
        </a>
      </div>

      <div class="kehua-content-right-time">
        <div class="kehua-content-right-time-left">
          <span @click="goDetail">{{ timeAgo(post.created_at) }}</span>
          <span v-if="canEdit" class="edit-action" @click="edit">编辑</span>
          <span v-if="canDelete" class="del-action" @click="remove">删除</span>
        </div>
        <div class="kehua-content-right-time-right">
          <div v-if="showMenu" class="action-menu">
            <div class="action-menu-item" title="查看详情" @click="goDetail">
              <i class="ri-file-list-3-line"></i><span>详情</span>
            </div>
            <div class="action-menu-divider"></div>
            <div class="action-menu-item" :class="{ liked }" @click="toggleLike">
              <i :class="liked ? 'ri-heart-3-fill' : 'ri-heart-3-line'"></i>
              <span>{{ liked ? '取消' : '赞' }}</span>
            </div>
            <div class="action-menu-divider"></div>
            <div class="action-menu-item" @click="openEditor">
              <i class="ri-chat-3-line"></i><span>评论</span>
            </div>
          </div>
          <div class="dots-btn" @click.stop="showMenu = !showMenu">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>

      <div v-if="likers.length || comments.length || showEditor" class="kehua-zanp">
        <div v-if="likers.length" class="kehua-zanp-zan">
          <div class="kehua-zanp-zan-left"><i class="ri-heart-3-fill"></i></div>
          <ul class="kehua-zanp-zan-right">
            <li
              v-for="(l, i) in likers"
              :key="i"
              class="liker"
              :class="{ guest: l.guest }"
              :title="likerTitle(l)"
              @click="goUser(l.id)"
            >
              {{ l.nickname }}
            </li>
          </ul>
        </div>

        <CommentList
          v-if="comments.length"
          class="kehua-zanp-pl"
          :comments="comments"
          :post-id="post.id"
          :show-all="expandComments"
          @reply="startReply"
          @refresh="reload"
          @open-all="expandComments = true"
        />

        <CommentEditor
          v-if="showEditor"
          :post-id="post.id"
          :reply-to="replyTo"
          @done="onCommentDone"
          @cancel="closeEditor"
          @cancel-reply="replyTo = null"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { guestNickname, store, toast, confirmDialog, openLightbox } from '../store.js';
import { renderText, timeAgo, needCollapse } from '../utils.js';
import ImageGrid from './ImageGrid.vue';
import MusicCard from './MusicCard.vue';
import LinkCard from './LinkCard.vue';
import CommentList from './CommentList.vue';
import CommentEditor from './CommentEditor.vue';

const props = defineProps({
  post: { type: Object, required: true },
});
const emit = defineEmits(['removed', 'updated']);

const router = useRouter();
const expanded = ref(false);
const showMenu = ref(false);
const showEditor = ref(false);
const replyTo = ref(null);
const comments = ref(props.post.comments || []);
const expandComments = ref(false);
const likers = ref(props.post.likers || []);
const liked = ref(!!props.post.liked);

const images = computed(() => props.post.images || []);
const collapsible = computed(() => needCollapse(props.post.content || ''));
const canEdit = computed(
  () => store.user && (store.user.role === 'admin' || props.post.user_id === store.user.id)
);
const canDelete = computed(
  () => store.user && (store.user.role === 'admin' || props.post.user_id === store.user.id)
);

watch(
  () => props.post,
  (p) => {
    comments.value = p.comments || [];
    likers.value = p.likers || [];
    liked.value = !!p.liked;
  },
  { deep: true }
);

function goAuthor() {
  router.push(`/author/${props.post.user_id}`);
}
function goUser(id) {
  if (id) router.push(`/author/${id}`);
}
/** 点赞名单里的悬浮提示：区分「登记过昵称的访客」和「纯匿名访客」 */
function likerTitle(l) {
  if (!l.guest) return `查看 ${l.nickname} 的主页`;
  return /^访客( ×\d+)?$/.test(l.nickname)
    ? '匿名访客（按浏览器识别）'
    : '访客登记的昵称';
}
function goDetail() {
  showMenu.value = false;
  router.push(`/post/${props.post.id}`);
}
function normalize(url) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}
function onOpenImage(i) {
  openLightbox(images.value, i);
}

async function toggleLike() {
  try {
    /* 游客点赞时带上登记过的昵称（登录用户传空，服务端用账号昵称） */
    const data = await api.post(`/api/posts/${props.post.id}/like`, {
      nickname: guestNickname(),
    });
    liked.value = data.liked;
    likers.value = data.likers;
    showMenu.value = false;
  } catch (e) {
    toast(e.message, 'error');
  }
}

function openEditor() {
  showEditor.value = true;
  showMenu.value = false;
}
function closeEditor() {
  showEditor.value = false;
  replyTo.value = null;
}
function startReply(comment) {
  if (!store.user) {
    store.loginOpen = true;
    toast('登录后回复更方便，也可以填写昵称直接评论');
  }
  replyTo.value = { id: comment.id, nickname: comment.nickname };
  showEditor.value = true;
}
function onCommentDone(list) {
  comments.value = list;
  expandComments.value = true;
  replyTo.value = null;
  showEditor.value = false;
  emit('updated');
}

async function reload() {
  try {
    const data = await api.get(`/api/posts/${props.post.id}`);
    comments.value = data.comments || [];
    likers.value = data.likers || [];
    liked.value = data.liked;
    emit('updated');
  } catch {}
}

function edit() {
  router.push(`/write?edit=${props.post.id}`);
}

async function remove() {
  const ok = await confirmDialog('删除后无法恢复，确定删除这条动态？', { title: '删除动态' });
  if (!ok) return;
  try {
    await api.del(`/api/posts/${props.post.id}`);
    toast('已删除');
    emit('removed', props.post.id);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function onDocClick(e) {
  if (!e.target.closest('.kehua-content-right-time-right')) showMenu.value = false;
}
onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));
</script>
