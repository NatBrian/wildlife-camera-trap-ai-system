import { supabase } from "./supabaseClient";
import { SpeciesCounts } from "@/types";

type UploadArgs = {
  videoBlob: Blob;
  thumbnailBlob?: Blob | null;
  startedAt: Date;
  endedAt: Date;
  deviceId: string;
  speciesCounts: SpeciesCounts;
  framesWithAnimals: number;
};

export type UploadResult = {
  videoUrl?: string;
  thumbnailUrl?: string;
};

export async function uploadClipToSupabase({
  videoBlob,
  thumbnailBlob,
  startedAt,
  endedAt,
  deviceId,
  speciesCounts,
  framesWithAnimals,
}: UploadArgs): Promise<UploadResult> {
  // 1. Register clip and get signed upload URLs from server
  const response = await fetch("/api/register-clip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      startedAt,
      endedAt,
      deviceId,
      speciesCounts,
      framesWithAnimals,
      videoContentType: videoBlob.type,
      thumbnailContentType: thumbnailBlob ? thumbnailBlob.type : null,
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to register clip");
  }

  const { videoPath, videoToken, thumbnailPath, thumbnailToken } = await response.json();
  const bucket = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || "clips";

  // 2. Upload Video using Signed URL
  const { error: videoErr } = await supabase.storage
    .from(bucket)
    .uploadToSignedUrl(videoPath, videoToken, videoBlob);

  if (videoErr) throw new Error(`Video upload failed: ${videoErr.message}`);

  // 3. Upload Thumbnail using Signed URL (if exists)
  if (thumbnailBlob && thumbnailPath && thumbnailToken) {
    const { error: thumbErr } = await supabase.storage
      .from(bucket)
      .uploadToSignedUrl(thumbnailPath, thumbnailToken, thumbnailBlob);

    if (thumbErr) throw new Error(`Thumbnail upload failed: ${thumbErr.message}`);
  }

  // 4. Get Public URLs for display
  const { data: videoPublic } = supabase.storage.from(bucket).getPublicUrl(videoPath);
  const { data: thumbPublic } = supabase.storage.from(bucket).getPublicUrl(thumbnailPath);

  return {
    videoUrl: videoPublic.publicUrl,
    thumbnailUrl: thumbPublic.publicUrl,
  };
}
