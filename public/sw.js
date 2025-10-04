// Service Worker for drose.io Admin PWA
const CACHE_NAME = 'admin-v5';
const ASSETS_TO_CACHE = [
  '/admin.html',
  '/manifest.json'
];

// Install - cache assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch - smart caching strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // App shell: cache-first for offline reliability
  if (url.pathname === '/admin.html' ||
      url.pathname === '/manifest.json' ||
      url.pathname === '/sw.js') {
    event.respondWith(
      caches.match(event.request)
        .then(cached => cached || fetch(event.request)
          .then(response => {
            // Cache the fetched version
            caches.open(CACHE_NAME).then(cache =>
              cache.put(event.request, response.clone())
            );
            return response;
          })
        )
    );
    return;
  }

  // API calls: network-first with timeout, cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      Promise.race([
        fetch(event.request).then(response => {
          // Cache successful GET requests
          if (event.request.method === 'GET' && response.ok) {
            caches.open(CACHE_NAME).then(cache =>
              cache.put(event.request, response.clone())
            );
          }
          return response;
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 5000)
        )
      ]).catch(() => caches.match(event.request))
    );
    return;
  }

  // Everything else: network-first with cache fallback
  event.respondWith(
    fetch(event.request)
      .catch(() => caches.match(event.request))
  );
});

// Push notification
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};

  const options = {
    body: data.message || 'New message from visitor',
    icon: '/assets/icons/icon-192.png',
    badge: '/assets/icons/badge-72.png',
    tag: data.visitorId || 'admin-notification',
    data: {
      url: '/admin.html',
      visitorId: data.visitorId
    },
    vibrate: [200, 100, 200],
    requireInteraction: true
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'New Message', options)
  );
});

// Push subscription change - resubscribe automatically
self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('Push subscription changed, resubscribing...');

  event.waitUntil(
    (async () => {
      try {
        // Get the admin password from IndexedDB or prompt user to re-login
        // For now, we'll try to resubscribe if we have the VAPID key
        const response = await fetch('/api/push/vapid-public-key');
        const { publicKey } = await response.json();

        // Subscribe to push notifications
        const subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        });

        // Note: This won't have auth token, so server-side needs to handle
        // or we need to store auth token in IndexedDB
        console.log('Resubscribed to push notifications:', subscription.endpoint.substring(0, 50));

        // Try to send to server (may fail if no auth available)
        // In production, you'd want to store auth token in IndexedDB
        await fetch('/api/admin/push-subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subscription)
        }).catch(err => {
          console.warn('Failed to register new subscription with server:', err.message);
        });
      } catch (error) {
        console.error('Failed to resubscribe:', error);
      }
    })()
  );
});

// Helper function for VAPID key conversion
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Notification click - focus existing window or open new one
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    (async () => {
      // Get all open windows
      const clientList = await clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      });

      // Find existing admin window
      const adminClient = clientList.find(client =>
        client.url.includes('admin.html')
      );

      if (adminClient) {
        // Focus existing window
        await adminClient.focus();

        // Optionally send message to open specific thread
        if (event.notification.data?.visitorId) {
          adminClient.postMessage({
            type: 'open-thread',
            visitorId: event.notification.data.visitorId
          });
        }
      } else {
        // Open new window if none exists
        await clients.openWindow(event.notification.data?.url || '/admin.html');
      }
    })()
  );
});
