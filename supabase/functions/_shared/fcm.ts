// Real push delivery - to the driver app (new dispatch / staff
// cancellation) and to customer-web (order accepted/dispatched/driver
// nearby, via the browser's Web Push, same Firebase project as the
// driver app's Android app) - see _shared/notify.ts's own header, which
// documents that this project previously had zero working notification
// infrastructure. This talks to Firebase Cloud Messaging's HTTP v1 API
// directly (no Firebase Admin SDK exists for Deno), which means doing
// the OAuth2 service-account exchange by hand: sign a short-lived JWT
// with the service account's private key, trade it for an access token,
// then POST the actual message.
//
// Credentials come from Supabase secrets (FCM_PROJECT_ID/FCM_CLIENT_EMAIL/
// FCM_PRIVATE_KEY, set via `supabase secrets set` - never committed to a
// migration or the repo, same rule as CRON_SECRET).

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function textToBase64url(text: string): string {
  return base64url(new TextEncoder().encode(text));
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  // Secrets are stored as single-line values with literal \n escape
  // sequences (that's how the JSON file itself represents the key) -
  // turn those back into real newlines before stripping the PEM wrapper.
  const normalized = pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
  const base64 = normalized
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 30_000) {
    return cachedAccessToken.token;
  }

  const clientEmail = Deno.env.get("FCM_CLIENT_EMAIL");
  const privateKeyPem = Deno.env.get("FCM_PRIVATE_KEY");
  if (!clientEmail || !privateKeyPem) {
    throw new Error("FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY not configured");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const unsigned = `${textToBase64url(JSON.stringify(header))}.${textToBase64url(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${base64url(new Uint8Array(signature))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`FCM token exchange failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  cachedAccessToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedAccessToken.token;
}

/**
 * Sends a push to one device token. Never throws on a per-message failure
 * (an unregistered/stale token, or FCM not configured at all) - a failed
 * push is a degraded experience, not a reason to fail the caller's actual
 * work (dispatching/cancelling an order), so every failure is caught and
 * logged instead.
 */
export async function sendPush(
  fcmToken: string,
  title: string,
  body: string,
  data: Record<string, string> = {},
  // Only meaningful for a Web token (customer-web) - opened when the
  // customer taps the notification. Android ignores this block entirely,
  // same reasoning as why the android block below is harmless to send
  // even when the target is a Web token: FCM only applies whichever
  // platform-specific block matches the receiving token.
  webLink?: string,
): Promise<void> {
  const projectId = Deno.env.get("FCM_PROJECT_ID");
  if (!projectId) {
    console.warn("FCM_PROJECT_ID not configured - push not sent");
    return;
  }
  try {
    const accessToken = await getAccessToken();
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: fcmToken,
            notification: { title, body },
            data,
            android: {
              priority: "high",
              notification: { channel_id: "driver_alerts", sound: "default" },
            },
            webpush: webLink ? { fcm_options: { link: webLink } } : undefined,
          },
        }),
      },
    );
    if (!res.ok) {
      console.warn(`FCM send failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.warn(`FCM send threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}
