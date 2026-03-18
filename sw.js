const CACHE_NAME = 'flightclub-v3';
const BASE = '/fightclub-dart-tracker';
const ASSETS = [
    BASE + '/index.html',
    BASE + '/game.html',
    BASE + '/dashboard.html',
    BASE + '/admin.html',
    BASE + '/style.css',
    BASE + '/game-logic.js',
    BASE + '/ui-manager-game.js',
    BASE + '/ui-manager-dashboard.js',
    BASE + '/database.js',
    BASE + '/checkout.js',
    BASE + '/Logo.png',
    BASE + '/manifest.json',
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