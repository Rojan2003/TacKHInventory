import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    public?: boolean
    /** User must hold at least one of these permissions (UX only; the backend enforces them again). */
    permissions?: string[]
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { title: 'Sign in', public: true } },
  {
    path: '/',
    component: () => import('@/components/layout/AppShell.vue'),
    children: [
      { path: '', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { title: 'Dashboard', permissions: ['dashboard.view'] } },
      { path: 'inventory', name: 'inventory', component: () => import('@/views/InventoryView.vue'), meta: { title: 'Literature Inventory', permissions: ['items.view'] } },
      { path: 'inventory/:itemId', name: 'item-detail', component: () => import('@/views/ItemDetailView.vue'), meta: { title: 'Item Details', permissions: ['items.view'] } },
      { path: 'deliveries', name: 'deliveries', component: () => import('@/views/DeliveriesView.vue'), meta: { title: 'Incoming Deliveries', permissions: ['deliveries.view'] } },
      { path: 'deliveries/new', name: 'delivery-new', component: () => import('@/views/DeliveryFormView.vue'), meta: { title: 'Record Delivery', permissions: ['deliveries.manage'] } },
      { path: 'deliveries/:deliveryId/edit', name: 'delivery-edit', component: () => import('@/views/DeliveryFormView.vue'), meta: { title: 'Edit Delivery', permissions: ['deliveries.manage'] } },
      { path: 'deliveries/:deliveryId', name: 'delivery-detail', component: () => import('@/views/DeliveryDetailView.vue'), meta: { title: 'Delivery', permissions: ['deliveries.view'] } },
      { path: 'requests', name: 'requests', component: () => import('@/views/RequestsView.vue'), meta: { title: 'Congregation Requests', permissions: ['requests.view.all', 'requests.view.own'] } },
      { path: 'requests/new', name: 'request-new', component: () => import('@/views/RequestFormView.vue'), meta: { title: 'New Request', permissions: ['requests.create'] } },
      { path: 'requests/:requestId/edit', name: 'request-edit', component: () => import('@/views/RequestFormView.vue'), meta: { title: 'Edit Request', permissions: ['requests.create'] } },
      { path: 'requests/:requestId', name: 'request-detail', component: () => import('@/views/RequestDetailView.vue'), meta: { title: 'Request', permissions: ['requests.view.all', 'requests.view.own'] } },
      { path: 'distributions', name: 'distributions', component: () => import('@/views/DistributionsView.vue'), meta: { title: 'Distributions', permissions: ['distributions.view.all', 'distributions.view.own'] } },
      { path: 'distributions/new', name: 'distribution-new', component: () => import('@/views/DistributionFormView.vue'), meta: { title: 'Release Literature', permissions: ['distributions.create'] } },
      { path: 'distributions/:distributionId', name: 'distribution-detail', component: () => import('@/views/DistributionDetailView.vue'), meta: { title: 'Distribution', permissions: ['distributions.view.all', 'distributions.view.own'] } },
      { path: 'congregations', name: 'congregation-stock', component: () => import('@/views/CongregationStockView.vue'), meta: { title: 'Congregation Stock', permissions: ['stock.view.all', 'stock.view.own'] } },
      { path: 'reports', name: 'reports', component: () => import('@/views/ReportsView.vue'), meta: { title: 'Reports', permissions: ['reports.view', 'reports.view.own'] } },
      { path: 'admin', name: 'admin', component: () => import('@/views/AdminView.vue'), meta: { title: 'User Management', permissions: ['users.manage'] } },
      { path: 'forbidden', name: 'forbidden', component: () => import('@/views/ForbiddenView.vue'), meta: { title: 'Not allowed' } },
      { path: ':pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFoundView.vue'), meta: { title: 'Not found' } },
    ],
  },
]

export const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

const APP_NAME = import.meta.env.VITE_APP_NAME || 'East Congregation Literature Inventory'

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (to.meta.public) {
    if (to.name === 'login' && auth.isAuthenticated) return { name: 'dashboard' }
    return true
  }
  if (!auth.isAuthenticated) return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} }
  if (to.meta.permissions && !auth.canAny(to.meta.permissions)) return { name: 'forbidden' }
  return true
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · ${APP_NAME}` : APP_NAME
})
