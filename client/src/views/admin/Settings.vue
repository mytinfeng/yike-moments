<template>
  <div v-if="s" style="display: flex; flex-direction: column; gap: 16px; max-width: 860px">
    <div class="card">
      <div class="card-head">
        <h3>站点信息</h3>
        <button class="a-btn primary" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存设置' }}
        </button>
      </div>
      <div class="card-body a-form">
        <div class="sec-title">基础信息</div>
        <div class="a-row">
          <div class="a-field">
            <label>站点名称</label>
            <input v-model="s.site_name" class="a-input" maxlength="20" />
            <div class="desc">显示在封面头像左侧的大字</div>
          </div>
          <div class="a-field">
            <label>站点签名</label>
            <input v-model="s.site_desc" class="a-input" maxlength="60" />
            <div class="desc">头像下方的一行小字</div>
          </div>
        </div>

        <div class="a-field">
          <label>头像</label>
          <div class="upload-thumbs">
            <div v-if="s.avatar" class="upload-preview">
              <img :src="s.avatar" alt="" />
              <span class="del" @click="s.avatar = ''"><i class="ri-close-line"></i></span>
            </div>
            <div class="upload-box" @click="avatarInput?.click()">
              <i class="ri-image-add-line"></i>上传头像
            </div>
            <div class="upload-box" @click="openLib('avatar', { title: '选择站点头像' })">
              <i class="ri-folder-image-line"></i>媒体库
            </div>
          </div>
        </div>

        <div class="a-row">
          <div class="a-field">
            <label>每页动态数</label>
            <input v-model.number="s.page_size" class="a-input" type="number" min="1" max="30" />
          </div>
          <div class="a-field">
            <label>主题色</label>
            <div style="display: flex; gap: 8px; align-items: center">
              <input v-model="s.theme_color" class="a-input" style="flex: 1" />
              <input v-model="s.theme_color" type="color" style="width: 40px; height: 38px; border: 1px solid #e3e6ec; border-radius: 8px; padding: 2px" />
            </div>
            <div class="desc">前台按钮、标签等强调色</div>
          </div>
        </div>

        <div class="a-field">
          <label>底部版权文字</label>
          <input v-model="s.footer_text" class="a-input" maxlength="80" />
        </div>

        <div class="sec-title" style="margin-top: 22px">网站 TDK（搜索引擎）</div>
        <div class="a-field">
          <label>标题 Title</label>
          <input
            v-model="s.seo_title"
            class="a-input"
            maxlength="60"
            :placeholder="s.site_name || '壹刻'"
          />
          <div class="desc">浏览器标签页和搜索结果的大标题，建议 30 字以内；留空则用站点名称。</div>
        </div>
        <div class="a-field">
          <label>描述 Description</label>
          <textarea
            v-model="s.seo_description"
            class="a-textarea"
            rows="3"
            maxlength="160"
            :placeholder="s.site_desc || '一句话说清这个站点记录什么'"
          ></textarea>
          <div class="desc">
            搜索结果标题下面那段话，建议 80 字以内；留空则用站点签名。当前
            {{ (s.seo_description || '').length }} 字。
          </div>
        </div>
        <div class="a-field">
          <label>关键词 Keywords</label>
          <input
            v-model="s.seo_keywords"
            class="a-input"
            maxlength="120"
            placeholder="用英文逗号分隔，如：生活记录,随手拍,个人主页"
          />
          <div class="desc">多个关键词用英文逗号分隔，留空则不输出关键词标签。</div>
        </div>
        <div class="a-field">
          <label>搜索结果预览</label>
          <div
            style="
              border: 1px solid #e3e6ec;
              border-radius: 10px;
              padding: 14px 16px;
              background: #fafbfc;
              max-width: 600px;
            "
          >
            <div style="font-size: 17px; line-height: 1.4; color: #1a0dab; margin-bottom: 3px">
              {{ s.seo_title || s.site_name || '壹刻' }}
            </div>
            <div style="font-size: 12px; color: #0a7d32; margin-bottom: 5px">{{ siteHost }}</div>
            <div style="font-size: 13px; line-height: 1.65; color: #4d5156">
              {{
                s.seo_description ||
                s.site_desc ||
                '这里会显示站点描述，建议写清楚这个站点记录什么。'
              }}
            </div>
          </div>
          <div class="desc">保存后刷新前台即可生效，首屏 HTML 由服务端直接注入，爬虫能抓到。</div>
        </div>

        <div class="sec-title" style="margin-top: 22px">封面</div>
        <div class="a-field">
          <label>封面类型</label>
          <select v-model="s.cover_type" class="a-select" style="max-width: 260px">
            <option value="image">单张图片</option>
            <option value="slideshow">多图轮播</option>
            <option value="video">视频</option>
          </select>
        </div>

        <div v-if="s.cover_type === 'image'" class="a-field">
          <label>封面图片</label>
          <div class="upload-thumbs">
            <div v-if="s.cover_image" class="upload-preview" style="width: 180px; height: 110px">
              <img :src="s.cover_image" alt="" />
              <span class="del" @click="s.cover_image = ''"><i class="ri-close-line"></i></span>
            </div>
            <div class="upload-box" style="width: 180px; height: 110px" @click="coverInput?.click()">
              <i class="ri-image-add-line"></i>上传封面
            </div>
            <div
              class="upload-box"
              style="width: 180px; height: 110px"
              @click="openLib('cover_image', { title: '选择封面图片' })"
            >
              <i class="ri-folder-image-line"></i>媒体库
            </div>
          </div>
        </div>

        <div v-if="s.cover_type === 'slideshow'" class="a-field">
          <label>轮播图片（最多 5 张）</label>
          <div class="upload-thumbs">
            <div v-for="(img, i) in s.cover_images" :key="img + i" class="upload-preview" style="width: 140px; height: 90px">
              <img :src="img" alt="" />
              <span class="del" @click="s.cover_images.splice(i, 1)"><i class="ri-close-line"></i></span>
            </div>
            <template v-if="s.cover_images.length < 5">
              <div
                class="upload-box"
                style="width: 140px; height: 90px"
                @click="slideInput?.click()"
              >
                <i class="ri-image-add-line"></i>添加图片
              </div>
              <div
                class="upload-box"
                style="width: 140px; height: 90px"
                @click="
                  openLib('cover_images', {
                    title: '选择轮播图片',
                    multiple: true,
                    max: 5 - s.cover_images.length,
                    exclude: s.cover_images,
                  })
                "
              >
                <i class="ri-folder-image-line"></i>媒体库
              </div>
            </template>
          </div>
        </div>

        <div v-if="s.cover_type === 'video'" class="a-field">
          <label>视频地址</label>
          <input v-model="s.cover_video" class="a-input" placeholder="https://…mp4 或上传本地视频" />
          <div class="a-actions" style="margin-top: 10px">
            <button class="a-btn" @click="videoInput?.click()"><i class="ri-upload-2-line"></i>上传视频</button>
            <button class="a-btn" @click="openLib('cover_video', { type: 'video', title: '选择封面视频' })">
              <i class="ri-folder-video-line"></i>从媒体库选
            </button>
            <span class="hint" style="font-size: 12px; color: #6b7484">建议 720p 以内，自动静音循环播放</span>
          </div>
        </div>

        <div class="sec-title" style="margin-top: 22px">封面文案</div>
        <div class="a-field">
          <label>欢迎语</label>
          <input
            v-model="s.cover_welcome"
            class="a-input"
            maxlength="26"
            placeholder="欢迎光临{site}的朋友圈"
          />
          <div class="desc">
            <code>{site}</code> 自动替换成站点名称。只在访客第一次打开时单独显示 2 秒，之后并入下面的随机池。
          </div>
        </div>
        <div class="a-field">
          <label>到访语</label>
          <input v-model="s.cover_visit" class="a-input" maxlength="26" placeholder="{count}位朋友到访过~" />
          <div class="desc">
            <code>{count}</code> 自动替换成到访人数：1000 显示为 1k，1 万显示为 10k，100 万显示为 1M。
          </div>
        </div>
        <div class="a-field">
          <label>彩蛋文案</label>
          <textarea
            v-model="s.cover_lines"
            class="a-textarea"
            rows="6"
            maxlength="800"
            placeholder="一行一句，例如：来看看今天有更新吗？"
          ></textarea>
          <div class="desc">
            一行一句，建议每句不超过 20 字。播完一轮会重新打乱，每 2 秒换一条；留空则只轮到访语。
          </div>
        </div>

        <div class="sec-title" style="margin-top: 22px">功能开关</div>
        <div class="a-row">
          <div class="a-field">
            <label>开放注册</label>
            <select v-model="s.allow_register" class="a-select">
              <option value="1">允许游客注册</option>
              <option value="0">关闭注册</option>
            </select>
          </div>
          <div class="a-field">
            <label>评论审核</label>
            <select v-model="s.comment_audit" class="a-select">
              <option value="0">游客评论直接显示</option>
              <option value="1">游客评论需审核</option>
            </select>
          </div>
        </div>
        <div class="a-row">
          <div class="a-field">
            <label>夜间模式自动切换</label>
            <select v-model="s.night_auto" class="a-select">
              <option value="1">19:00 - 07:00 自动切换</option>
              <option value="0">仅手动切换</option>
            </select>
          </div>
          <div class="a-field">
            <label>悬浮音乐播放器</label>
            <select v-model="s.show_music_player" class="a-select">
              <option value="1">显示</option>
              <option value="0">隐藏</option>
            </select>
          </div>
        </div>

        <div class="sec-title" style="margin-top: 22px">背景音乐</div>
        <div v-for="(m, i) in s.bg_music" :key="i" class="a-field" style="background: #fafbfc; border: 1px solid #eef0f4; border-radius: 10px; padding: 12px">
          <div class="a-row">
            <input v-model="m.title" class="a-input" placeholder="歌曲名" />
            <input v-model="m.artist" class="a-input" placeholder="歌手" />
            <button class="a-btn danger" style="height: 38px" @click="s.bg_music.splice(i, 1)">
              <i class="ri-delete-bin-line"></i>
            </button>
          </div>
          <div style="display: flex; gap: 8px; margin-top: 8px">
            <input v-model="m.url" class="a-input" style="flex: 1" placeholder="音频地址 https://…mp3" />
            <button
              class="a-btn"
              style="height: 38px; flex-shrink: 0"
              title="从媒体库选音频"
              @click="openLib('music_url', { type: 'audio', title: '选择背景音乐' }, i)"
            >
              <i class="ri-folder-music-line"></i>
            </button>
          </div>
          <div style="display: flex; gap: 8px; margin-top: 8px">
            <input v-model="m.cover" class="a-input" style="flex: 1" placeholder="封面图地址（选填）" />
            <button
              class="a-btn"
              style="height: 38px; flex-shrink: 0"
              title="从媒体库选封面图"
              @click="openLib('music_cover', { title: '选择音乐封面' }, i)"
            >
              <i class="ri-folder-image-line"></i>
            </button>
          </div>
        </div>
        <div class="a-actions">
          <button class="a-btn" @click="s.bg_music.push({ title: '', artist: '', url: '', cover: '' })">
            <i class="ri-add-line"></i>添加音乐
          </button>
          <button class="a-btn" @click="audioInput?.click()"><i class="ri-upload-2-line"></i>上传音频</button>
          <button class="a-btn" @click="openLib('audio', { type: 'audio', title: '选择背景音乐' })">
            <i class="ri-folder-music-line"></i>从媒体库选
          </button>
        </div>
        <p class="desc" style="margin-top: 8px">上传的音频会自动追加到列表第一项（需填写歌名）。</p>

        <div class="a-actions" style="margin-top: 26px; padding-top: 18px; border-top: 1px solid #eef0f4">
          <button class="a-btn primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存全部设置' }}</button>
          <button class="a-btn" @click="reload">重置修改</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h3>
          AI 评论审核
          <span
            class="badge"
            :class="ai.configured ? 'green' : 'gray'"
            style="margin-left: 8px; vertical-align: 2px"
          >
            {{ ai.configured ? '运行中' : '未启用' }}
          </span>
        </h3>
        <div class="a-actions">
          <button class="a-btn" :disabled="testing" @click="testAi">
            <i class="ri-plug-line"></i>{{ testing ? '测试中…' : '测试连接' }}
          </button>
          <button class="a-btn primary" :disabled="runningAi || !ai.configured" @click="runAi">
            <i class="ri-robot-2-line"></i>{{ runningAi ? '审核中…' : '立即审核' }}
          </button>
        </div>
      </div>
      <div class="card-body a-form">
        <p class="desc" style="margin-bottom: 14px">
          支持任何兼容 OpenAI Chat Completions 协议的服务（官方 / 中转站均可）。定时任务每
          <b>{{ ai.intervalHours || s.ai_interval_hours }}</b> 小时跑一次，没有待审评论时不会调用接口；每轮最多审核
          10 条（一次请求），剩余的留到下一轮或手动再点一次。
        </p>

        <div class="a-row">
          <div class="a-field">
            <label>开启 AI 审核</label>
            <select v-model="s.ai_enabled" class="a-select">
              <option value="0">关闭</option>
              <option value="1">开启</option>
            </select>
          </div>
          <div class="a-field">
            <label>审核间隔（小时）</label>
            <input v-model.number="s.ai_interval_hours" class="a-input" type="number" min="1" max="72" />
            <div class="desc">默认 3 小时；改完保存后立即生效，不用重启</div>
          </div>
        </div>

        <div class="a-field">
          <label>接口地址</label>
          <input
            v-model="s.ai_base_url"
            class="a-input"
            placeholder="https://api.example.com/v1"
            spellcheck="false"
          />
          <div class="desc">
            填到 <code>/v1</code> 即可，也可以直接填完整的 <code>/v1/chat/completions</code>
          </div>
        </div>

        <div class="a-row">
          <div class="a-field">
            <label>API Key</label>
            <div style="display: flex; gap: 8px">
              <input
                v-model="s.ai_api_key"
                class="a-input"
                :type="showKey ? 'text' : 'password'"
                placeholder="sk-…"
                spellcheck="false"
                autocomplete="off"
              />
              <button class="a-btn" style="height: 38px; flex: 0 0 auto" @click="showKey = !showKey">
                <i :class="showKey ? 'ri-eye-off-line' : 'ri-eye-line'"></i>
              </button>
            </div>
          </div>
          <div class="a-field">
            <label>模型 ID</label>
            <input v-model="s.ai_model" class="a-input" placeholder="gpt-4o-mini" spellcheck="false" />
            <div class="desc">填中转站支持的模型名，如 gpt-4o-mini / deepseek-chat</div>
          </div>
        </div>

        <div class="a-row">
          <div class="a-field">
            <label>每批审核条数</label>
            <input v-model.number="s.ai_batch_size" class="a-input" type="number" min="1" max="10" />
            <div class="desc">上限 10 条，超出按 10 条处理</div>
          </div>
          <div class="a-field">
            <label>通过后自动放行</label>
            <select v-model="s.ai_auto_approve" class="a-select">
              <option value="1">AI 通过即自动显示（含待审核）</option>
              <option value="0">仍需人工点通过</option>
            </select>
          </div>
        </div>

        <div class="a-field">
          <label>屏蔽词</label>
          <textarea
            v-model="s.banned_words"
            class="a-textarea"
            rows="3"
            placeholder="用逗号或换行分隔，命中直接拒绝，例如：发票, 博彩, 加微信"
          ></textarea>
          <div class="desc">本地先拦一层，命中即返回「包含敏感词」，不消耗 AI 额度</div>
        </div>

        <div class="ai-stat">
          <div>
            <span class="k">AI 待审</span>
            <b>{{ ai.pending ?? 0 }}</b> 条
          </div>
          <div>
            <span class="k">AI 判定违规</span>
            <b>{{ ai.rejected ?? 0 }}</b> 条
          </div>
          <div>
            <span class="k">上次运行</span>
            {{ ai.last ? ai.last.started_at : '还没有运行过' }}
          </div>
          <div>
            <span class="k">下次自动</span>
            {{
              ai.nextRunAt
                ? new Date(ai.nextRunAt).toLocaleString('zh-CN', { hour12: false })
                : ai.configured
                  ? '即将开始'
                  : '—'
            }}
          </div>
        </div>

        <div v-if="ai.last" class="ai-last" :class="ai.last.status">
          <i
            :class="
              ai.last.status === 'error'
                ? 'ri-error-warning-line'
                : ai.last.status === 'skipped'
                  ? 'ri-time-line'
                  : 'ri-checkbox-circle-line'
            "
          ></i>
          <span>{{ ai.last.message }}</span>
        </div>

        <div v-if="ai.recent && ai.recent.length > 1" class="ai-history">
          <div class="sec-title" style="margin-top: 18px">最近运行记录</div>
          <div v-for="r in ai.recent.slice(1)" :key="r.id" class="ai-history-row">
            <span class="time">{{ r.started_at?.slice(5, 16) }}</span>
            <span class="badge" :class="r.status === 'error' ? 'orange' : r.status === 'skipped' ? 'gray' : 'green'">
              {{ r.status === 'error' ? '失败' : r.status === 'skipped' ? '跳过' : '完成' }}
            </span>
            <span class="msg">{{ r.message }}</span>
          </div>
        </div>
      </div>
    </div>

    <input ref="avatarInput" type="file" accept="image/*" hidden @change="(e) => uploadTo(e, 'avatar')" />
    <input ref="coverInput" type="file" accept="image/*" hidden @change="(e) => uploadTo(e, 'cover_image')" />
    <input ref="slideInput" type="file" accept="image/*" multiple hidden @change="uploadSlides" />
    <input ref="videoInput" type="file" accept="video/*" hidden @change="(e) => uploadTo(e, 'cover_video')" />
    <input ref="audioInput" type="file" accept="audio/*" hidden @change="uploadAudio" />

    <MediaPicker
      v-model:open="libOpen"
      :type="libCfg.type"
      :title="libCfg.title"
      :multiple="libCfg.multiple"
      :max="libCfg.max"
      :exclude="libCfg.exclude"
      @select="onLibPick"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';
import { applyFavicon, store, toast } from '../../store.js';
import MediaPicker from '../../components/MediaPicker.vue';

/* 媒体库选择弹窗：target 决定选完往哪个字段塞 */
const libOpen = ref(false);
const libCfg = reactive({
  target: '',
  index: -1,
  type: 'image',
  title: '选择图片',
  multiple: false,
  max: 0,
  exclude: [],
});

function openLib(target, opts = {}, index = -1) {
  libCfg.target = target;
  libCfg.index = index;
  libCfg.type = opts.type || 'image';
  libCfg.title = opts.title || '选择图片';
  libCfg.multiple = !!opts.multiple;
  libCfg.max = opts.max || 0;
  libCfg.exclude = opts.exclude || [];
  libOpen.value = true;
}

function onLibPick(urls) {
  if (!urls?.length || !s.value) return;
  const one = urls[0];
  switch (libCfg.target) {
    case 'avatar':
      s.value.avatar = one;
      break;
    case 'cover_image':
      s.value.cover_image = one;
      break;
    case 'cover_video':
      s.value.cover_video = one;
      break;
    case 'cover_images':
      s.value.cover_images.push(...urls.slice(0, Math.max(0, 5 - s.value.cover_images.length)));
      break;
    case 'audio':
      s.value.bg_music.push({
        title: decodeURIComponent(one.split('/').pop().replace(/\.[^.]+$/, '')),
        artist: '',
        url: one,
        cover: '',
      });
      break;
    case 'music_url':
      if (s.value.bg_music[libCfg.index]) s.value.bg_music[libCfg.index].url = one;
      break;
    case 'music_cover':
      if (s.value.bg_music[libCfg.index]) s.value.bg_music[libCfg.index].cover = one;
      break;
    default:
      break;
  }
  toast('已选用，记得点「保存设置」');
}

const s = ref(null);
/* 预览里显示的域名，纯粹为了让"搜索结果长什么样"更直观 */
const siteHost = computed(() =>
  typeof location !== 'undefined' ? location.host : 'localhost'
);
const saving = ref(false);
const avatarInput = ref(null);
const coverInput = ref(null);
const slideInput = ref(null);
const videoInput = ref(null);
const audioInput = ref(null);

const ai = ref({ configured: false, pending: 0, rejected: 0, last: null, recent: [] });
const showKey = ref(false);
const testing = ref(false);
const runningAi = ref(false);

async function reload() {
  const data = await api.get('/api/admin/settings');
  s.value = data;
}

async function loadAiStatus() {
  try {
    ai.value = await api.get('/api/admin/ai/status');
  } catch {
    /* 未登录或接口异常时保持上一次状态 */
  }
}

async function testAi() {
  if (!s.value.ai_base_url || !s.value.ai_api_key || !s.value.ai_model) {
    return toast('请先填写接口地址、API Key 和模型 ID', 'error');
  }
  testing.value = true;
  try {
    const r = await api.post('/api/admin/ai/test', {
      base_url: s.value.ai_base_url,
      api_key: s.value.ai_api_key,
      model: s.value.ai_model,
    });
    toast(`连接正常，耗时 ${r.ms}ms，模型回复：${r.reply || '（空）'}`);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    testing.value = false;
  }
}

async function runAi() {
  runningAi.value = true;
  try {
    const r = await api.post('/api/admin/ai/run', {});
    if (r.status === 'skipped') toast(r.message);
    else if (r.status === 'error') toast(r.errors?.[0] || '审核失败', 'error');
    else {
      const left = r.remaining ? `，还有 ${r.remaining} 条待审` : '';
      toast(`审核 ${r.checked} 条，通过 ${r.passed}，违规 ${r.rejected}${left}`);
    }
    await loadAiStatus();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    runningAi.value = false;
  }
}

async function uploadTo(e, field) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = await api.upload([file]);
    s.value[field] = data.files[0].url;
    toast('上传成功');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    e.target.value = '';
  }
}

async function uploadSlides(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  try {
    const data = await api.upload(files.slice(0, 5 - s.value.cover_images.length));
    s.value.cover_images.push(...data.files.map((f) => f.url));
    toast('上传成功');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    e.target.value = '';
  }
}

async function uploadAudio(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = await api.upload([file]);
    s.value.bg_music.push({
      title: file.name.replace(/\.[^.]+$/, ''),
      artist: '',
      url: data.files[0].url,
      cover: '',
    });
    toast('音频已上传，记得填写歌名后保存');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    e.target.value = '';
  }
}

async function save() {
  saving.value = true;
  try {
    const payload = {
      site_name: s.value.site_name,
      site_desc: s.value.site_desc,
      seo_title: s.value.seo_title || '',
      seo_description: s.value.seo_description || '',
      seo_keywords: s.value.seo_keywords || '',
      avatar: s.value.avatar,
      cover_type: s.value.cover_type,
      cover_image: s.value.cover_image,
      cover_video: s.value.cover_video,
      cover_images: s.value.cover_images,
      cover_welcome: s.value.cover_welcome,
      cover_visit: s.value.cover_visit,
      cover_lines: s.value.cover_lines,
      theme_color: s.value.theme_color,
      page_size: String(s.value.page_size),
      night_auto: s.value.night_auto,
      allow_register: s.value.allow_register,
      comment_audit: s.value.comment_audit,
      footer_text: s.value.footer_text,
      bg_music: s.value.bg_music,
      show_music_player: s.value.show_music_player,
      ai_enabled: s.value.ai_enabled,
      ai_base_url: s.value.ai_base_url,
      ai_api_key: s.value.ai_api_key,
      ai_model: s.value.ai_model,
      ai_interval_hours: String(s.value.ai_interval_hours || 3),
      ai_batch_size: String(Math.min(10, Math.max(1, Number(s.value.ai_batch_size) || 10))),
      ai_auto_approve: s.value.ai_auto_approve,
      banned_words: s.value.banned_words,
    };
    await api.put('/api/admin/settings', payload);
    toast('设置已保存');
    const fresh = await api.get('/api/settings');
    store.settings = { ...store.settings, ...fresh };
    if (fresh.theme_color) document.documentElement.style.setProperty('--theme', fresh.theme_color);
    document.title = fresh.seo_title || fresh.site_name || '壹刻';
    const desc = fresh.seo_description || fresh.site_desc;
    const descEl = document.querySelector('meta[name="description"]');
    if (descEl && desc) descEl.setAttribute('content', desc);
    const kwEl = document.querySelector('meta[name="keywords"]');
    if (kwEl && fresh.seo_keywords) kwEl.setAttribute('content', fresh.seo_keywords);
    applyFavicon(fresh.avatar);
    await loadAiStatus();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  reload();
  loadAiStatus();
});
</script>
