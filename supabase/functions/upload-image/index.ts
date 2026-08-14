// Security audit finding MEDIUM-2 (Batch 6, 2026-08-14): the direct client
// upload path for menu-images/branch-images trusted whatever Content-Type
// the browser/client declared - Supabase Storage's allowed_mime_types check
// only compares against that declared header, never the actual file bytes,
// so a mislabeled upload (e.g. HTML declared as image/png) was accepted and
// later served back publicly with the attacker-chosen Content-Type intact.
//
// This function is now the ONLY way to write to those two buckets (see
// migration 0060, which dropped the direct-client storage.objects write
// policies) - it reads the real bytes and checks them against actual image
// magic-byte signatures before ever calling storage, and writes with the
// server-DETECTED type, never the client's claim. general_manager-only,
// matching both tables' existing write RLS (menu_items_write_general_manager,
// branches_write_general_manager) and the storage policies this replaces -
// no privilege is being added or removed for who may set a photo, only how
// the bytes get validated on the way in.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";

const MAX_BYTES = 5 * 1024 * 1024; // matches each bucket's own file_size_limit (0008/0027)

type DetectedType = { ext: string; contentType: string };

// Real signature checks, not filename/declared-header trust - exactly the
// three types each bucket's allowed_mime_types already permits.
function detectImageType(bytes: Uint8Array): DetectedType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg", contentType: "image/jpeg" };
  }
  const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && pngSig.every((b, i) => bytes[i] === b)) {
    return { ext: "png", contentType: "image/png" };
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // "WEBP"
  ) {
    return { ext: "webp", contentType: "image/webp" };
  }
  return null;
}

const BUCKET_CONFIG: Record<string, { table: string; column: string }> = {
  "menu-images": { table: "menu_items", column: "image_url" },
  "branch-images": { table: "branches", column: "photo_url" },
};

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (caller.role !== "general_manager") return errorResponse("only general_manager can upload this image", 403);

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return errorResponse("expected multipart/form-data with a file field");
  }

  const bucket = formData.get("bucket");
  const entityIdRaw = formData.get("entity_id");
  const file = formData.get("file");

  if (typeof bucket !== "string" || !(bucket in BUCKET_CONFIG)) {
    return errorResponse(`bucket must be one of: ${Object.keys(BUCKET_CONFIG).join(", ")}`);
  }
  if (typeof entityIdRaw !== "string" || !entityIdRaw.trim()) return errorResponse("entity_id is required");
  const entityId = Number(entityIdRaw);
  if (!Number.isInteger(entityId) || entityId <= 0) return errorResponse("entity_id must be a positive integer");
  if (!(file instanceof File)) return errorResponse("file is required");
  if (file.size === 0) return errorResponse("file is empty");
  if (file.size > MAX_BYTES) return errorResponse("file exceeds the 5MB limit", 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectImageType(bytes);
  if (!detected) {
    return errorResponse("file content is not a recognized JPEG, PNG, or WebP image", 422);
  }

  const admin = getAdminClient();
  const config = BUCKET_CONFIG[bucket];

  const { data: existing } = await admin.from(config.table).select("id").eq("id", entityId).maybeSingle();
  if (!existing) return errorResponse(`${config.table} row ${entityId} not found`, 404);

  const path = `${entityId}.${detected.ext}`;
  const { error: uploadError } = await admin.storage.from(bucket).upload(path, bytes, {
    upsert: true,
    cacheControl: "3600",
    contentType: detected.contentType,
  });
  if (uploadError) return dbErrorResponse("upload-image", uploadError.message);

  const { data: publicUrlData } = admin.storage.from(bucket).getPublicUrl(path);
  const url = `${publicUrlData.publicUrl}?t=${Date.now()}`;

  const { error: updateError } = await admin.from(config.table).update({ [config.column]: url }).eq("id", entityId);
  if (updateError) return dbErrorResponse("upload-image", updateError.message);

  return jsonResponse({ url });
});
