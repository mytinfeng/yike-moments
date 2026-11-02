<template>
  <div class="centent">
    <div class="kehua-main">
      <div class="page-head">
        <button class="head-back" @click="back"><i class="ri-arrow-left-line"></i></button>
        <h2>动态详情</h2>
        <button class="head-back" @click="store.searchOpen = true"><i class="ri-search-line"></i></button>
      </div>

      <div v-if="loading" class="detail-wrap">
        <div class="skeleton" style="height: 200px; margin: 0 20px"></div>
      </div>

      <div v-else-if="error" class="empty-state">
        <i class="ri-error-warning-line"></i>{{ error }}
      </div>

      <div v-else-if="post" class="detail-wrap">
        <div class="detail-card">
          <img
            v-lazy.eager="post.avatar || store.settings.avatar"
            class="avatar-lg"
            alt=""
            @click="goAuthor"
          />
          <div class="detail-main">
            <div class="detail-name" @click="goAuthor">{{ post.nickname }}</div>
            <div class="detail-text" v-html="renderText(post.content)"></div>

            <ImageGrid v-if="post.images && post.images.length" :images="post.images" @open="openImg" />

            <div v-if="post.video" class="post-video" style="width: 100%">
              <video :src="post.video" controls playsinline></video>
            </div>

            <MusicCard v-if="post.music && post.music.url" :track="post.music" />

            <LinkCard v-if="post.link && post.link.url" :link="post.link" />

            <a v-if="post.location" class="post-location" href="javascript:void(0)">
              <i class="ri-map-pin-line"></i>{{ post.location }}
            </a>

            <a v-if="post.ad_url" class="ad-link" :href="normalize(post.ad_url)" target="_blank" rel="noopener">
              <i class="ri-link"></i>{{ post.ad_url }}
            </a>

            <div class="detail-time">{{ fullDate(post.created_at) }}</div>

            <div class="detail-actions">
              <button :class="{ liked }" @click="toggleLike">
                <i :class="liked ? 'ri-heart-3-fill' : 'ri-heart-3-line'"></i>
                {{ liked ? '已赞' : '赞' }} {{ likeCount }}
              </button>
              <button @click="focusEditor">
                <i class="ri-chat-3-line"></i>评论 {{ comments.length }}
              </button>
              <button v-if="canDelete" @click="removePost"><i class="ri-delete-bin-line"></i>删除</button>
            </div>
          </div>
        </div>

        <div v-if="likers.length" class="detail-section">
          <h3>赞</h3>
          <div class="kehua-zanp-zan-right">
            <span
              v-for="l in likers"
              :key="l.id"
              class="liker"
              :class="{ guest: l.guest }"
              :title="l.guest ? '匿名访客（按浏览器识别）' : ''"
              @click="l.id && $router.push(`/author/${l.id}`)"
            >
              {{ l.nickname }}
            </span>
          </div>
        </div>

        <div class="detail-section">
          <h3>评论 {{ comments.length }}</h3>
          <CommentList
            ref="listRef"
            class="comments-full"
            :comments="comments"
            :post-id="post.id"
            :show-all="true"
            :detail="true"
            @reply="startReply"
            @refresh="reload"
          />
          <div v-if="replyTo" class="editor-reply-tip" style="margin: 10px 0 4px">
            正在回复 <b>@{{ replyTo.nickname }}</b>
            <i class="ri-close-circle-line" @click="replyTo = null"></i>
          </div>
          <CommentEditor
            ref="editorRef"
            :post-id="post.id"
            :reply-to="replyTo"
            style="margin-top: 10px"
            @done="onCommentDone"
            @cancel="replyTo = null"
          />
        </div>

        <FloatMenu :show-top="true" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { guestNickname, store, toast, openLightbox, confirmDialog } from '../store.js';
import { fullDate, renderText } from '../utils.js';
import ImageGrid from '../components/ImageGrid.vue';
import MusicCard from '../components/MusicCard.vue';
import LinkCard from '../components/LinkCard.vue';
import CommentList from '../components/CommentList.vue';
import CommentEditor from '../components/CommentEditor.vue';
import FloatMenu from '../components/FloatMenu.vue';

const route = useRoute();
const router = useRouter();

const post = ref(null);
const comments = ref([]);
const likers = ref([]);
const likeCount = ref(0);
const liked = ref(false);
const loading = ref(true);
const error = ref('');
const replyTo = ref(null);
const editorRef = ref(null);

const canDelete = computed(
  () => store.user && (store.user.role === 'admin' || post.value?.user_id === store.user.id)
);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await api.get(`/api/posts/${route.params.id}`);
    post.value = data;
    comments.value = data.comments || [];
    likers.value = data.likers || [];
    likeCount.value = data.like_count || 0;
    liked.value = !!data.liked;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function reload() {
  try {
    const data = await api.get(`/api/posts/${route.params.id}`);
    comments.value = data.comments || [];
    likers.value = data.likers || [];
    likeCount.value = data.like_count || 0;
    liked.value = !!data.liked;
  } catch {}
}

async function toggleLike() {
  try {
    /* 游客点赞带上登记过的昵称，登录用户传空由服务端取账号昵称 */
    const data = await api.post(`/api/posts/${post.value.id}/like`, {
      nickname: guestNickname(),
    });
    liked.value = data.liked;
    likers.value = data.likers;
    likeCount.value = data.like_count ?? data.likers.length;
  } catch (e) {
    toast(e.message, 'error');
  }
}

function goAuthor() {
  router.push(`/author/${post.value.user_id}`);
}
function openImg(i) {
  openLightbox(post.value.images, i);
}
function normalize(url) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}
function back() {
  if (window.history.length > 1) router.back();
  else router.push('/');
}
function startReply(c) {
  replyTo.value = { id: c.id, nickname: c.nickname };
  nextTick(() => editorRef.value?.$el?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
}
function onCommentDone(list) {
  comments.value = list;
  replyTo.value = null;
  if (post.value) post.value.comment_count = list.length;
}
function focusEditor() {
  editorRef.value?.$el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
async function removePost() {
  const ok = await confirmDialog('删除后无法恢复，确定删除这条动态？', { title: '删除动态' });
  if (!ok) return;
  await api.del(`/api/posts/${post.value.id}`);
  toast('已删除');
  router.push('/');
}

watch(() => route.params.id, load, { immediate: true });
</script>
