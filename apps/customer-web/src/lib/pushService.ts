import { initializeApp } from "firebase/app";
import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";
import { supabase } from "../supabaseClient";

// Same Firebase project as the driver app (apps/driver_app) - just a
// second "app" registration (Web) inside it. These are public client
// identifiers, not secrets (same status as the Supabase anon key already
// shipped in this bundle) - safe to hardcode.
const firebaseConfig = {
  apiKey: "AIzaSyAkRCI4w5WwRKoSy6sNPDrN9oUBNU17GTM",
  authDomain: "abdoaseem-driver.firebaseapp.com",
  projectId: "abdoaseem-driver",
  storageBucket: "abdoaseem-driver.firebasestorage.app",
  messagingSenderId: "889694678840",
  appId: "1:889694678840:web:47e7d0b65d0089c8119bcd",
};

const VAPID_KEY =
  "BK1Vh249ZK92VZYxjdIoEjzBNBeDw6nvLiw0fDkAIRL_pdpcl55AZgHC-zsnAT7sz3TWaMBw5YXNuU4lBJmP2cQ";

/**
 * Registers this browser for push and saves the token on the customer's
 * own row (users.fcm_token, migration 0026 - originally added for the
 * driver app, this reuses the same column since it's just "this account's
 * current push endpoint" regardless of role). Call after the customer has
 * explicitly opted in (a button, never on page load unprompted) - returns
 * false for anything that stops it from working (unsupported browser,
 * permission denied, no service worker) so the caller can show a plain
 * "مش متاحة على المتصفح ده" message instead of failing silently.
 */
export async function enablePushNotifications(): Promise<boolean> {
  try {
    if (!(await isSupported())) return false;
    if (!("serviceWorker" in navigator)) return false;

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const app = initializeApp(firebaseConfig);
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    if (!token) return false;

    const uid = (await supabase.auth.getSession()).data.session?.user.id;
    if (!uid) return false;
    await supabase.from("users").update({ fcm_token: token }).eq("id", uid);

    // Foreground tabs don't get an automatic system notification for a
    // push message the way background/closed tabs do - show one manually
    // so the behavior is consistent either way.
    onMessage(messaging, (payload) => {
      if (Notification.permission === "granted" && payload.notification) {
        new Notification(payload.notification.title ?? "", { body: payload.notification.body });
      }
    });

    return true;
  } catch {
    return false;
  }
}

export function pushPermissionState(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}
