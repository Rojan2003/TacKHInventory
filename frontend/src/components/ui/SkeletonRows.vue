<script setup lang="ts">
defineProps<{ rows: number; cols: number }>()
</script>

<template>
  <tr v-for="r in rows" :key="r" class="animate-pulse">
    <td v-for="c in cols" :key="c" class="px-3 py-3">
      <div class="h-3.5 rounded bg-gray-200" :style="{ width: `${40 + ((r * 7 + c * 13) % 50)}%` }" />
    </td>
  </tr>
</template>
