// Runs in a separate service-worker context (no access to the page's own
// JS/state) - this is what lets a push notification show up even while
// the site tab is closed, same reason the driver app needs its own
// background handler (see push_service.dart). Config values are public
// client identifiers (not secrets, same status as the Supabase anon key
// already shipped in this app) so hardcoding them here is fine - a
// service worker file can't read import.meta.env at request time.
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAkRCI4w5WwRKoSy6sNPDrN9oUBNU17GTM",
  authDomain: "abdoaseem-driver.firebaseapp.com",
  projectId: "abdoaseem-driver",
  storageBucket: "abdoaseem-driver.firebasestorage.app",
  messagingSenderId: "889694678840",
  appId: "1:889694678840:web:47e7d0b65d0089c8119bcd",
});

const messaging = firebase.messaging();

// Background messages already show a system notification automatically
// via the `notification` payload - this handler exists so a click on
// that notification focuses/opens the site instead of doing nothing.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.FCM_MSG?.notification?.click_action || "/orders";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url.includes(self.location.origin) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
