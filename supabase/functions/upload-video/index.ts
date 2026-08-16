// Video-file fallback for the homepage promo video list (migration 0067)
// alongside pasting a Facebook link - same "never trust the client's
// declared Content-Type, check the real bytes" rule upload-image.ts
// established for images. Unlike upload-image, this isn't one-photo-per-
// entity: each successful upload adds a new promo_videos row, same as
// pasting a link does from the dispatcher-web form.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";

const MAX_BYTES = 25 * 1024 * 1024; // matches promo-videos bucket's file_size_limit (0068)
const BUCKET = "promo-videos";

type DetectedType = { ext: string; contentType: string };

// Real signature checks against the three types the bucket allows.
// MP4/MOV/M4V all share the ISO base media "ftyp" box at byte offset 4;
// distinguishing mp4 from mov by brand isn't needed here since both are
// accepted and both play fine in a native <video> tag either way.
function detectVideoType(bytes: Uint8Array): DetectedType | null {
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 // "ftyp"
  ) {
    return { ext: "mp4", contentType: "video/mp4" };
  }
  const webmSig = [0x1a, 0x45, 0xdf, 0xa3];
  if (bytes.length >= 4 && webmSig.every((b, i) => bytes[i] === b)) {
    return { ext: "webm", contentType: "video/webm" };
  }
  return null;
}

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (!["general_manager", "team_leader"].includes(caller.role)) {
    return errorResponse("only general_manager/team_leader can upload promo videos", 403);
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
  if (file.size > MAX_BYTES) return errorResponse("file exceeds the 25MB limit", 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectVideoType(bytes);
  if (!detected) {
    return errorResponse("file content is not a recognized MP4 or WebM video", 422);
  }

  const admin = getAdminClient();
  const path = `${crypto.randomUUID()}.${detected.ext}`;
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, {
    upsert: false,
    cacheControl: "3600",
    contentType: detected.contentType,
  });
  if (uploadError) return dbErrorResponse("upload-video", uploadError.message);

  const { data: publicUrlData } = admin.storage.from(BUCKET).getPublicUrl(path);
  const url = publicUrlData.publicUrl;

  const { error: insertError } = await admin.from("promo_videos").insert({ video_url: url, created_by: caller.id });
  if (insertError) return dbErrorResponse("upload-video", insertError.message);

  return jsonResponse({ url });
});
