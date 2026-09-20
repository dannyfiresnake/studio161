// Tombstone: the service worker was removed. This stub exists only to evict any
// worker still registered in a client from a previous version — it clears all
// caches, unregisters itself, and reloads the page so fresh content loads with
// no SW in control. Nothing registers this anymore; it can be deleted once all
// clients have launched at least once after this change.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
      await self.registration.unregister()
      const clients = await self.clients.matchAll({ type: 'window' })
      clients.forEach((c) => c.navigate(c.url))
    })()
  )
})
