// Shared (module-level) reactive state so the layout and settings page agree.
const supported = ref(false)
const permission = ref<NotificationPermission>('default')
const subscribed = ref(false)
let initialized = false

/** VAPID public key (base64url) → Uint8Array for PushManager.subscribe. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

/**
 * Browser push (spec 10.1). Registers the service worker, requests permission,
 * subscribes via the Push API and registers the subscription with the backend.
 */
export function usePushNotifications() {
  const { api } = useApi()

  async function init() {
    if (!import.meta.client || initialized) return
    initialized = true
    supported.value = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    if (!supported.value) return
    permission.value = Notification.permission
    try {
      const reg = await navigator.serviceWorker.register('/sw.js')
      const sub = await reg.pushManager.getSubscription()
      subscribed.value = !!sub
      // Re-register an existing subscription with the backend in case the row
      // was lost (DB reset, new login) — keeps server and browser in sync.
      if (sub && permission.value === 'granted') {
        const json = sub.toJSON() as any
        await api('/push/subscribe', { method: 'POST', body: { endpoint: json.endpoint, keys: json.keys } }).catch(() => {})
      }
    } catch (e) {
      console.error('[push] service worker registration failed', e)
    }
  }

  /** Request permission and subscribe. Returns true on success. */
  async function enable(): Promise<boolean> {
    if (!supported.value) return false
    permission.value = await Notification.requestPermission()
    if (permission.value !== 'granted') return false

    const reg = await navigator.serviceWorker.ready
    const { publicKey } = await api<{ publicKey: string | null }>('/push/vapid-public-key')
    if (!publicKey) {
      console.warn('[push] server returned no VAPID public key')
      return false
    }
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
    const json = sub.toJSON() as any
    await api('/push/subscribe', { method: 'POST', body: { endpoint: json.endpoint, keys: json.keys } })
    subscribed.value = true
    return true
  }

  async function disable() {
    if (!supported.value) return
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {})
      await sub.unsubscribe().catch(() => {})
    }
    subscribed.value = false
  }

  return { supported, permission, subscribed, init, enable, disable }
}
