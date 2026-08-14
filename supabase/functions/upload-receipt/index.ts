// Security audit finding MEDIUM-2 residual (Batch 8, 2026-08-14): the
// driver_app's direct client upload to the `receipts` bucket
// (dispatcher_service.dart's uploadPhoto()) trusted whatever Content-Type
// the file carried - the same client-declared-MIME-only gap already fixed
// for menu-images/branch-images (Batch 6), left open here at the time
// since receipts/payment-proofs have different callers and path
// conventions that couldn't be blindly reused from that fix.
//
// This function is now the only way to write to `receipts` (see migration
// 0062, which drops the receipts_insert_dispatcher storage.objects policy)
// - it reads the real bytes and checks them against actual image magic-
// byte signatures before ever calling storage, using the server-detected
// type, never the client's claim. Authorization mirrors the RLS policy it
// replaces exactly: dispatcher role, active, and the path is always
// branch-scoped to the CALLER'S OWN branch_id (read from their own server-
// side profile, never a client-supplied value - stricter than the RLS
// expression it replaces, which could only check whatever branch_id
// appeared in the path the client chose to write to).
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { detectImageType, MAX_UPLOAD_BYTES } from "../_shared/imageValidation.ts";

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (caller.role !== "dispatcher") return errorResponse("only dispatcher can upload a receipt photo", 403);
  if (!caller.branch_id) return errorResponse("your account has no branch assigned", 422);

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return errorResponse("expected multipart/form-data with a file field");
  }

  const orderIdRaw = formData.get("order_id");
  const file = formData.get("file");

  if (typeof orderIdRaw !== "string" || !orderIdRaw.trim()) return errorResponse("order_id is required");
  const orderId = Number(orderIdRaw);
  if (!Number.isInteger(orderId) || orderId <= 0) return errorResponse("order_id must be a positive integer");
  if (!(file instanceof File)) return errorResponse("file is required");
  if (file.size === 0) return errorResponse("file is empty");
  if (file.size > MAX_UPLOAD_BYTES) return errorResponse("file exceeds the 5MB limit", 413);

  const admin = getAdminClient();

  // Same "does this order belong to your branch" check dispatch-order and
  // photograph-order already apply - the path is about to embed order_id
  // under this dispatcher's own branch, so the order must actually be theirs.
  const { data: order, error: orderError } = await admin.from("orders").select("id, branch_id").eq("id", orderId).maybeSingle();
  if (orderError) return dbErrorResponse("upload-receipt", orderError.message);
  if (!order) return errorResponse("order not found", 404);
  if (order.branch_id !== caller.branch_id) return errorResponse("order does not belong to your branch", 403);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectImageType(bytes);
  if (!detected) {
    return errorResponse("file content is not a recognized JPEG, PNG, or WebP image", 422);
  }

  const path = `${caller.branch_id}/${orderId}/${Date.now()}.${detected.ext}`;
  const { error: uploadError } = await admin.storage.from("receipts").upload(path, bytes, {
    contentType: detected.contentType,
  });
  if (uploadError) return dbErrorResponse("upload-receipt", uploadError.message);

  // A raw storage path, not a public URL - `receipts` is a private bucket;
  // callers generate a signed URL on demand when they actually need to view
  // it, same convention already used for payment_proof_url elsewhere.
  return jsonResponse({ path });
});
