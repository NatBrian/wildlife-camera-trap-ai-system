import Link from "next/link";
import { notFound } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import { Clip } from "@/types";

type Props = {
  params: { id: string };
};

export const revalidate = 0;

export default async function ClipDetail({ params }: Props) {
  const { data, error } = await supabase.from("clips").select("*").eq("id", params.id).single();
  if (!data || error) return notFound();

  const clip = data as Clip;
  const started = new Date(clip.started_at);
  const ended = new Date(clip.ended_at);

  return (
    <div className="space-y-4">
      <Link href="/" className="text-mint hover:underline">
        ← Back to clips
      </Link>

      <div className="glass rounded-2xl p-6">
        <div className="flex flex-col md:flex-row gap-6">
          {clip.thumbnail_url ? (
            <img
              src={clip.thumbnail_url}
              alt={`Thumbnail for ${clip.primary_species || "clip"}`}
              className="w-full md:w-72 rounded-xl border border-white/10 object-cover"
            />
          ) : (
            <div className="w-full md:w-72 h-48 rounded-xl border border-white/10 flex items-center justify-center text-slate-400">
              No thumbnail
            </div>
          )}

          <div className="flex-1 space-y-3">
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-[0.2em]">Primary species</p>
              <h2 className="text-2xl font-semibold text-mint">
                {clip.primary_species || "Unknown"} {clip.max_animals ? `• ${clip.max_animals} seen` : ""}
              </h2>
            </div>

            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-slate-400">Device</dt>
                <dd className="text-slate-100">{clip.device_id}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Duration</dt>
                <dd className="text-slate-100">{clip.duration_sec.toFixed(1)} sec</dd>
              </div>
              <div>
                <dt className="text-slate-400">Start</dt>
                <dd className="text-slate-100">{started.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-slate-400">End</dt>
                <dd className="text-slate-100">{ended.toLocaleString()}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-slate-400">Local video path</dt>
                <dd className="text-slate-100 font-mono text-xs">{clip.local_video_path || "Stored on device"}</dd>
              </div>
            </dl>

            <div className="glass rounded-xl p-3 border border-white/5">
              <p className="text-slate-400 text-xs uppercase tracking-[0.2em] mb-2">Species counts</p>
              {clip.species_counts ? (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(clip.species_counts).map(([species, count]) => (
                    <span key={species} className="pill bg-white/5 text-slate-200">
                      {species} · {count}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-slate-300">No per-species data</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
