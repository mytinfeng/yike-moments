import { createRouter, createWebHistory } from 'vue-router';
import { store } from './store.js';

const routes = [
  { path: '/', name: 'home', component: () => import('./views/Home.vue') },
  { path: '/post/:id', name: 'post', component: () => import('./views/PostDetail.vue') },
  { path: '/archives/:id', redirect: (to) => `/post/${to.params.id}` },
  { path: '/author/:id', name: 'author', component: () => import('./views/Author.vue') },
  { path: '/write', name: 'write', component: () => import('./views/Write.vue') },
  {
    path: '/admin/login',
    name: 'admin-login',
    component: () => import('./views/admin/AdminLogin.vue'),
  },
  {
    path: '/admin',
    component: () => import('./views/admin/AdminLayout.vue'),
    meta: { admin: true },
    children: [
      { path: '', name: 'admin-dashboard', component: () => import('./views/admin/Dashboard.vue') },
      { path: 'posts', name: 'admin-posts', component: () => import('./views/admin/Posts.vue') },
      { path: 'comments', name: 'admin-comments', component: () => import('./views/admin/Comments.vue') },
      { path: 'stickers', name: 'admin-stickers', component: () => import('./views/admin/Stickers.vue') },
      { path: 'media', name: 'admin-media', component: () => import('./views/admin/Media.vue') },
      {
        path: 'federation',
        name: 'admin-federation',
        component: () => import('./views/admin/Federation.vue'),
      },
      { path: 'users', name: 'admin-users', component: () => import('./views/admin/Users.vue') },
      { path: 'links', name: 'admin-links', component: () => import('./views/admin/Links.vue') },
      { path: 'settings', name: 'admin-settings', component: () => import('./views/admin/Settings.vue') },
      { path: 'profile', name: 'admin-profile', component: () => import('./views/admin/Profile.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('./views/NotFound.vue') },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, saved) {
    if (saved) return saved;
    if (to.path === from.path) return;
    return { top: 0 };
  },
});

router.beforeEach((to) => {
  if (to.meta.admin) {
    if (!store.user || store.user.role !== 'admin') {
      return { path: '/admin/login', query: { redirect: to.fullPath } };
    }
  }
  return true;
});

export default router;
