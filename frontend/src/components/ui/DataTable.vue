<script setup lang="ts" generic="T extends Record<string, any>">
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-vue-next'
import SkeletonRows from './SkeletonRows.vue'
import EmptyState from './EmptyState.vue'

export interface Column {
  key: string
  label: string
  sortable?: boolean
  align?: 'left' | 'right' | 'center'
  class?: string
  /** Hide on the mobile card layout. */
  hideOnCard?: boolean
}

const props = withDefaults(defineProps<{
  columns: Column[]
  rows: T[]
  rowKey: string
  loading?: boolean
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  emptyTitle?: string
  emptyMessage?: string
  clickable?: boolean
  dense?: boolean
}>(), { loading: false, emptyTitle: 'Nothing here yet', emptyMessage: '', clickable: false, dense: false })

const emit = defineEmits<{ sort: [key: string]; rowClick: [row: T] }>()

function alignClass(c: Column) {
  return c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
}

function onRow(row: T) {
  if (props.clickable) emit('rowClick', row)
}
</script>

<template>
  <div>
    <!-- Desktop table -->
    <div class="hidden md:block overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="border-b border-gray-200 bg-gray-50/70">
          <tr>
            <th v-for="c in columns" :key="c.key" :class="['table-head px-3 py-2.5', alignClass(c), c.class]" scope="col">
              <button v-if="c.sortable" type="button" class="inline-flex items-center gap-1 hover:text-ink" @click="emit('sort', c.key)" :aria-sort="sortBy === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'">
                {{ c.label }}
                <ArrowUp v-if="sortBy === c.key && sortDir === 'asc'" class="size-3.5" />
                <ArrowDown v-else-if="sortBy === c.key" class="size-3.5" />
                <ArrowUpDown v-else class="size-3.5 opacity-40" />
              </button>
              <span v-else>{{ c.label }}</span>
            </th>
            <th v-if="$slots.actions" class="table-head px-3 py-2.5 text-right" scope="col" aria-label="Actions"></th>
          </tr>
        </thead>
        <tbody v-if="loading && !rows.length">
          <SkeletonRows :rows="6" :cols="columns.length + ($slots.actions ? 1 : 0)" />
        </tbody>
        <tbody v-else class="divide-y divide-gray-100">
          <tr
            v-for="row in rows"
            :key="String(row[rowKey])"
            :class="[clickable ? 'cursor-pointer hover:bg-brand-50/60' : '', loading ? 'opacity-60' : '']"
            :tabindex="clickable ? 0 : undefined"
            @click="onRow(row)"
            @keydown.enter="onRow(row)"
          >
            <td v-for="c in columns" :key="c.key" :class="['px-3 align-middle', dense ? 'py-2' : 'py-3', alignClass(c), c.class]">
              <slot :name="`cell-${c.key}`" :row="row" :value="row[c.key]">{{ row[c.key] ?? '—' }}</slot>
            </td>
            <td v-if="$slots.actions" class="px-3 py-2 text-right whitespace-nowrap" @click.stop>
              <slot name="actions" :row="row" />
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-if="!loading && !rows.length" :title="emptyTitle" :message="emptyMessage" class="py-10" />
    </div>

    <!-- Mobile cards -->
    <div class="md:hidden">
      <div v-if="loading && !rows.length" class="space-y-3 p-3">
        <div v-for="i in 4" :key="i" class="h-24 animate-pulse rounded-xl bg-gray-100" />
      </div>
      <EmptyState v-else-if="!rows.length" :title="emptyTitle" :message="emptyMessage" class="py-10" />
      <ul v-else class="divide-y divide-gray-100" :class="loading ? 'opacity-60' : ''">
        <li v-for="row in rows" :key="String(row[rowKey])" :class="['p-4', clickable ? 'active:bg-brand-50/60' : '']" @click="onRow(row)">
          <slot name="card" :row="row">
            <dl class="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              <template v-for="c in columns.filter((x) => !x.hideOnCard)" :key="c.key">
                <dt class="text-xs text-muted">{{ c.label }}</dt>
                <dd class="text-right text-ink truncate"><slot :name="`cell-${c.key}`" :row="row" :value="row[c.key]">{{ row[c.key] ?? '—' }}</slot></dd>
              </template>
            </dl>
          </slot>
          <div v-if="$slots.actions" class="mt-3 flex justify-end gap-2" @click.stop>
            <slot name="actions" :row="row" />
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
