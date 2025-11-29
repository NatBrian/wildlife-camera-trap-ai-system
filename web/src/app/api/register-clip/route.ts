import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { v4 as uuidv4 } from "uuid";

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const {
            startedAt,
            endedAt,
            deviceId,
            speciesCounts,
            framesWithAnimals,
            videoContentType,
            thumbnailContentType,
        } = body;

        if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
            return NextResponse.json(
                { error: "Server misconfigured: Missing Service Role Key" },
                { status: 500 }
            );
        }

        // 1. Generate unique file paths
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const clipId = uuidv4();
        const videoPath = `${timestamp}_${clipId}.webm`; // Or use extension from content type
        const thumbnailPath = `${timestamp}_${clipId}.jpg`;

        // Calculate derived fields
        const start = new Date(startedAt);
        const end = new Date(endedAt);
        const durationSec = (end.getTime() - start.getTime()) / 1000;

        let primarySpecies = null;
        let maxAnimals = 0;
        if (speciesCounts && Object.keys(speciesCounts).length > 0) {
            primarySpecies = Object.keys(speciesCounts).reduce((a, b) => speciesCounts[a] > speciesCounts[b] ? a : b);
            maxAnimals = Math.max(...Object.values(speciesCounts) as number[]);
        }

        // Construct Public URL for thumbnail (so frontend can display it)
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const bucket = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || "clips";
        const publicThumbnailUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${thumbnailPath}`;

        // 2. Insert metadata into DB (bypassing RLS)
        const { data: clipData, error: dbError } = await supabaseAdmin
            .from("clips")
            .insert({
                device_id: deviceId,
                started_at: startedAt,
                ended_at: endedAt,
                duration_sec: durationSec,
                primary_species: primarySpecies,
                max_animals: maxAnimals,
                species_counts: speciesCounts,
                frames_with_animals: framesWithAnimals,
                thumbnail_url: publicThumbnailUrl,
                local_video_path: videoPath,
            })
            .select()
            .single();

        if (dbError) {
            console.error("DB Insert Error:", dbError);
            return NextResponse.json({ error: dbError.message }, { status: 500 });
        }

        // 3. Generate Signed Upload URLs (bypassing RLS)
        // Video
        const { data: videoSigned, error: videoError } = await supabaseAdmin.storage
            .from(bucket)
            .createSignedUploadUrl(videoPath);

        if (videoError || !videoSigned) {
            console.error("Video Signed URL Error:", videoError);
            return NextResponse.json({ error: videoError?.message || "Failed to sign video URL" }, { status: 500 });
        }

        // Thumbnail
        const { data: thumbSigned, error: thumbError } = await supabaseAdmin.storage
            .from(bucket)
            .createSignedUploadUrl(thumbnailPath);

        if (thumbError || !thumbSigned) {
            console.error("Thumbnail Signed URL Error:", thumbError);
            return NextResponse.json({ error: thumbError?.message || "Failed to sign thumbnail URL" }, { status: 500 });
        }

        return NextResponse.json({
            clip: clipData,
            videoUploadUrl: videoSigned.signedUrl,
            videoPath: videoSigned.path,
            videoToken: videoSigned.token,
            thumbnailUploadUrl: thumbSigned.signedUrl,
            thumbnailPath: thumbSigned.path,
            thumbnailToken: thumbSigned.token,
        });
    } catch (err) {
        console.error("API Error:", err);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
