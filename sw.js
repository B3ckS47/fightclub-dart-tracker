const CACHE_NAME = 'flightclub-v16';
const BASE = '/fightclub-dart-tracker';
const ASSETS = [
    BASE + '/index.html',
    BASE + '/game.html',
    BASE + '/dashboard.html',
    BASE + '/admin.html',
    BASE + '/style.css',
    BASE + '/ui-utils.js',
    BASE + '/game-logic.js',
    BASE + '/ui-manager-game.js',
    BASE + '/ui-manager-dashboard.js',
    BASE + '/database.js',
    BASE + '/checkout.js',
    BASE + '/Logo.png',
    BASE + '/manifest.json',
    BASE + '/config.js',
    BASE + '/fines.html',
    BASE + '/settings.html',
    BASE + '/schedule.html',
    BASE + '/schedule.js',
    BASE + '/spectator.html',
    BASE + '/tournaments.html',
    BASE + '/tournament-create.html',
    BASE + '/tournament-view.html',
    BASE + '/spieltag.html',
    BASE + '/spieltag-detail.html',
    BASE + '/icon-192.png',
    BASE + '/icon-512.png',
    BASE + '/apple-touch-icon.png'
];

// Install — cache all static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

// Activate — clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch — network first, fall back to cache
self.addEventListener('fetch', event => {
    // Skip non-GET and Supabase API requests (always need live data)
    if (event.request.method !== 'GET') return;
    if (event.request.url.includes('supabase.co')) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Update cache with fresh response
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
// ── PUSH NOTIFICATION HANDLER ──
self.addEventListener('push', event => {
    let data = {
        title: 'FlightClub 47',
        body:  'Erinnerung an einen bevorstehenden Termin.',
        url:   '/fightclub-dart-tracker/schedule.html'
    };
    if (event.data) {
        try { data = { ...data, ...event.data.json() }; } catch(e) {}
    }
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body:             data.body,
            icon:             '/fightclub-dart-tracker/icon-192.png',
            badge:            '/fightclub-dart-tracker/icon-192.png',
            data:             { url: data.url },
            vibrate:          [200, 100, 200],
            requireInteraction: false
        })
    );
});

// ── NOTIFICATION CLICK → open schedule ──
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const target = event.notification.data?.url || '/fightclub-dart-tracker/schedule.html';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            for (const client of list) {
                if (client.url.includes('fightclub-dart-tracker') && 'focus' in client) {
                    client.navigate(target);
                    return client.focus();
                }
            }
            return clients.openWindow(target);
        })
    );
});