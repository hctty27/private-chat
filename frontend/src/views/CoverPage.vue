<template>
  <div class="min-h-screen bg-gray-100">
    <!-- Header -->
    <header class="bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-lg sticky top-0 z-50">
      <div class="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
        <h1 class="text-xl font-bold tracking-wide">有趣</h1>
        <div class="flex items-center gap-3 text-sm">
          <span class="cursor-pointer hover:underline">消息</span>
          <span class="cursor-pointer hover:underline">发现</span>
        </div>
      </div>
    </header>

    <main class="max-w-3xl mx-auto px-4 py-4 space-y-4">
      <div
        v-if="coverNotice"
        class="bg-orange-50 border border-orange-200 text-orange-700 rounded-lg px-4 py-3 text-sm shadow-sm"
      >
        {{ coverNotice }}
      </div>

      <!-- Hot Topics -->
      <section class="bg-white rounded-lg shadow overflow-hidden">
        <div
          class="px-4 py-3 bg-orange-50 border-b flex items-center cursor-pointer select-none"
          @click="onHotClick"
        >
          <span class="text-orange-500 font-bold text-sm">🔥</span>
          <h2 class="ml-2 font-semibold text-gray-800" id="hot-title">有趣热搜</h2>
        </div>
        <ul class="divide-y divide-gray-100">
          <li
            v-for="(item, index) in hotTopics"
            :key="index"
            class="px-4 py-3 flex items-center gap-3 hover:bg-gray-50 cursor-pointer"
          >
            <span
              class="w-5 h-5 flex items-center justify-center text-xs font-bold rounded"
              :class="index < 3 ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-500'"
            >
              {{ index + 1 }}
            </span>
            <span class="text-sm text-gray-800 flex-1">{{ item.title }}</span>
            <span class="text-xs text-gray-400">{{ item.heat }}</span>
          </li>
        </ul>
      </section>

      <!-- Posts -->
      <section
        v-for="post in posts"
        :key="post.id"
        class="bg-white rounded-lg shadow p-4"
      >
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 rounded-full bg-gradient-to-br from-pink-400 to-orange-400 flex items-center justify-center text-white text-sm font-bold">
            {{ post.author[0] }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-semibold text-sm text-gray-900">{{ post.author }}</span>
              <span class="text-xs text-gray-400">{{ post.time }}</span>
            </div>
            <p class="mt-2 text-sm text-gray-700 leading-relaxed">{{ post.content }}</p>
            <div v-if="post.image" class="mt-3 rounded-lg overflow-hidden bg-gray-100">
              <img
                :src="post.image"
                class="w-full h-48 object-cover"
                :alt="post.content"
              />
            </div>
            <div class="mt-3 flex items-center gap-6 text-xs text-gray-400">
              <span class="cursor-pointer hover:text-orange-500">转发 {{ post.reposts }}</span>
              <span class="cursor-pointer hover:text-orange-500">评论 {{ post.comments }}</span>
              <span class="cursor-pointer hover:text-orange-500">赞 {{ post.likes }}</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const coverNotice = ref('')

const hotTopicTitles = [
  '春季赏花指南全国热门赏花地推荐',
  'AI技术突破性进展引发行业热议',
  '新能源汽车销量持续攀升',
  '年度最佳电影评选结果出炉',
  '健康饮食新理念受追捧',
  '音乐节巡演季即将开启',
  '国潮品牌崛起引领时尚潮流',
  '科技数码新品发布会汇总',
]

const hotTopics = ref(createHotTopics())

const postTimeOptions = ['刚刚', '3分钟前', '8分钟前', '16分钟前', '27分钟前', '43分钟前', '1小时前', '2小时前']

const posts = ref([
  {
    id: 1,
    author: '科技日报',
    time: '',
    content: '人工智能正在重塑我们的生活方式，从智能家居到自动驾驶，科技改变生活的脚步从未停歇。让我们一起期待更美好的未来！#科技改变生活#',
    image: 'https://picsum.photos/seed/tech/600/300',
    reposts: 1234,
    comments: 567,
    likes: 8901,
  },
  {
    id: 2,
    author: '美食达人小李',
    time: '',
    content: '今天尝试做了一道新菜，番茄牛腩配手工面条，味道超级棒！秘诀在于小火慢炖3小时，让牛肉充分入味。#家常菜谱# #美食分享#',
    image: 'https://picsum.photos/seed/food/600/300',
    reposts: 234,
    comments: 89,
    likes: 3456,
  },
  {
    id: 3,
    author: '旅行摄影师阿明',
    time: '',
    content: '清晨的湖面如镜，倒映着远山和云彩。大自然的美总能让人心旷神怡，这大概就是旅行的意义吧。📷 #旅行摄影# #风景如画#',
    image: 'https://picsum.photos/seed/travel/600/300',
    reposts: 567,
    comments: 234,
    likes: 5678,
  },
  {
    id: 4,
    author: '读书笔记分享',
    time: '',
    content: '最近在读《人类简史》，书中对人类历史的独特视角让人深思。推荐给每一位喜欢思考的朋友们！#好书推荐# #阅读分享#',
    reposts: 89,
    comments: 45,
    likes: 1234,
  },
])

let clickCount = 0
let clickTimer: ReturnType<typeof setTimeout> | null = null

function shuffle<T>(items: T[]) {
  return [...items].sort(() => Math.random() - 0.5)
}

function randomHeat(index: number) {
  const max = Math.max(118, 620 - index * 48)
  const min = Math.max(82, max - 160)
  return `${Math.floor(Math.random() * (max - min + 1)) + min}万`
}

function createHotTopics() {
  return shuffle(hotTopicTitles).map((title, index) => ({
    title,
    heat: randomHeat(index),
  }))
}

function applyRandomPostTimes() {
  const times = shuffle(postTimeOptions)
  posts.value = posts.value.map((post, index) => ({
    ...post,
    time: times[index % times.length],
  }))
}

function readCoverNotice() {
  if (typeof window === 'undefined') return
  try {
    const notice = window.sessionStorage.getItem('coverNotice')
    if (notice) {
      coverNotice.value = notice
      window.sessionStorage.removeItem('coverNotice')
    }
  } catch {
    // Ignore storage errors; cover page still works as a public disguise page.
  }
}

onMounted(() => {
  readCoverNotice()
  hotTopics.value = createHotTopics()
  applyRandomPostTimes()
})

function onHotClick() {
  clickCount++
  if (clickCount === 1) {
    clickTimer = setTimeout(() => {
      clickCount = 0
    }, 2000)
  }
  if (clickCount >= 3) {
    if (clickTimer) clearTimeout(clickTimer)
    clickCount = 0
    sessionStorage.setItem('fromCover', 'true')
    router.push('/login')
  }
}
</script>

<style>
html, body {
  margin: 0; padding: 0;
  -webkit-text-size-adjust: 100%;
  touch-action: manipulation;
}
</style>
