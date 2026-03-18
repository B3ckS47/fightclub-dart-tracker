const CACHE_NAME = 'flightclub-v1';
const ASSETS = [
    '/index.html',
    '/game.html',
    '/dashboard.html',
    '/admin.html',
    '/style.css',
    '/game-logic.js',
    '/ui-manager-game.js',
    '/ui-manager-dashboard.js',
    '/database.js',
    '/checkout.js',
    '/Logo.png',
    '/manifest.json'
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
