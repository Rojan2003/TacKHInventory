/** Build-time, public configuration. No side effects, safe to import anywhere (including tests). */
export const API_MODE: 'http' | 'mock' = import.meta.env.VITE_API_MODE === 'mock' ? 'mock' : 'http'
export const APP_NAME: string = import.meta.env.VITE_APP_NAME || 'East Congregation Literature Inventory'
