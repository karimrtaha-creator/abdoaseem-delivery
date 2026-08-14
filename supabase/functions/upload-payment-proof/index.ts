// Security audit finding MEDIUM-2 residual (Batch 8, 2026-08-14): both
// direct client uploads to the `payment-proofs` bucket (Checkout.tsx for a
// customer's own instapay proof, CallCenter.tsx for a phone-order guest's
// proof) trusted whatever Content-Type the file carried.
//
// This function is now the only way to write to `payment-proofs` (see
// migration 0062, which drops the payment_proofs_insert_owner_or_staff
// storage.objects policy) - it checks the real bytes against actual image
// magic-byte signatures before ever calling storage. Authorization and
// path shape exactly mirror the RLS policy/frontend conventions they
// replace:
//   - customer: path is always their OWN uid folder (read from their own
//     session, never client-supplied) - matches Checkout.tsx's existing
//     `${uid}/${timestamp}.jpg` shape.
//   - call_center/general_manager/team_leader: path is the guest phone
//     they're placing a phone order for - matches CallCenter.tsx's
//     existing `guest/${phone}-${timestamp}.jpg` shape. The phone is
//     digit-sanitized before it ever reaches a storage path (defense
//     against path traversal via a crafted "phone" value - the original
//     direct-upload flow had no such check since the browser's own fetch/
//     storage-client path-joining never gave a caller that opening, but a
//     raw multipart POST to this function could otherwise try).
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { detectImageType, MAX_UPLOAD_BYTES } from "../_shared/imageValidation.ts";

const STAFF_ROLES = ["call_center", "general_manager", "team_leader"];

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  const isStaff = STAFF_ROLES.includes(caller.role);
  if (caller.role !== "customer" && !isStaff) {
    return errorResponse("only a customer (their own proof) or call_center/general_manager/team_leader (a guest's proof) can upload a payment proof", 403);
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return errorResponse("expected multipart/form-data with a file field");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return errorResponse("file is required");
  if (file.size === 0) return errorResponse("file is empty");
  if (file.size > MAX_UPLOAD_BYTES) return errorResponse("file exceeds the 5MB limit", 413);

  let pathPrefix: string;
  if (isStaff) {
    const phoneRaw = formData.get("phone");
    if (typeof phoneRaw !== "string" || !phoneRaw.trim()) return errorResponse("phone is required");
    const phone = phoneRaw.replace(/\D/g, "");
    if (!phone) return errorResponse("phone must contain at least one digit");
    pathPrefix = `guest/${phone}`;
  } else {
    pathPrefix = caller.id;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectImageType(bytes);
  if (!detected) {
    return errorResponse("file content is not a recognized JPEG, PNG, or WebP image", 422);
  }

  const admin = getAdminClient();
  // customer path shape is "<uid>/<ts>.ext" (folder = uid, matches
  // Checkout.tsx); staff/guest path shape is "guest/<phone>-<ts>.ext"
  // (matches CallCenter.tsx) - pathPrefix already carries the right
  // folder segment for each case, only the separator before the
  // timestamp differs.
  const finalPath = isStaff ? `${pathPrefix}-${Date.now()}.${detected.ext}` : `${pathPrefix}/${Date.now()}.${detected.ext}`;

  const { error: uploadError } = await admin.storage.from("payment-proofs").upload(finalPath, bytes, {
    contentType: detected.contentType,
  });
  if (uploadError) return dbErrorResponse("upload-payment-proof", uploadError.message);

  // A raw storage path, not a public URL - `payment-proofs` is a private
  // bucket; a signed URL is generated on demand (AcceptanceLobby.tsx)
  // whenever someone with read access actually needs to view it.
  return jsonResponse({ path: finalPath });
});
