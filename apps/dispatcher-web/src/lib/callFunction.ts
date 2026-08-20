import { supabase } from "../supabaseClient";

// supabase-js's FunctionsHttpError.message is always a generic "Edge
// Function returned a non-2xx status code" string, no matter what the
// function actually rejected the request for - the real reason (e.g. "the
// account you're trying to review was already reviewed", "that phone
// number is already registered") only exists in the raw response body via
// .context. Every screen that called supabase.functions.invoke() directly
// and threw error.message as-is was showing this same generic string for
// every kind of failure - customer-web's Checkout.tsx got this same fix
// earlier; this is the dispatcher-web equivalent, extracted once instead
// of staying duplicated (with the same bug) across 7 different pages.
export async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const { data, error } = await supabase.functions.invoke(name, {
    body: body as any,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (error) {
    let serverMessage: string | null = null;
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const responseBody = await context.clone().json();
        serverMessage = typeof responseBody?.error === "string" ? responseBody.error : null;
      } catch {
        // response body wasn't JSON - fall through to the generic message
      }
    }
    throw new Error(serverMessage ?? error.message);
  }
  return data as T;
}
