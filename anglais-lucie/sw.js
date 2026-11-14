// Service worker minimal — sert uniquement à satisfaire les critères d'installation PWA
// (icône sur l'écran d'accueil). Pas de cache offline : l'app a besoin du réseau pour Firestore.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
