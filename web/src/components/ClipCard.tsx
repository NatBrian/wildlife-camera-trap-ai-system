import Link from "next/link";

import { Clip } from "@/types";

type Props = {
  clip: Clip;
};

export default function ClipCard({ clip }: Props) {
  const started = new Date(clip.started_at);
  const title = clip.primary_species || "Unknown species";

  return (
    <Link href={`/clips/${clip.id}`} className="block group">
      <div className="glass rounded-2xl p-4 border border-white/10 hover:border-mint/60 transition">
        <div className="flex flex-col md:flex-row gap-4">
          {clip.thumbnail_url ? (
            <img
              src={clip.thumbnail_url}
              alt={`Thumbnail for ${title}`}
              className="w-full md:w-44 h-32 object-cover rounded-xl border border-white/10"
              loading="lazy"
            />
          ) : (
            <div className="w-full md:w-44 h-32 rounded-xl border border-white/10 flex items-center justify-center text-slate-400">
              No thumbnail
            </div>
          )}

          <div className="flex-1 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Primary species</p>
                <h3 className="text-xl font-semibold text-mint">{title}</h3>
              </div>
              {clip.max_animals ? (
                <span className="pill bg-mint/20 text-mint border border-mint/30">max {clip.max_animals}</span>
              ) : null}
            </div>

            <p className="text-slate-300 text-sm">{started.toLocaleString()}</p>

            <div className="flex flex-wrap gap-2 text-xs text-slate-300">
              <span className="pill bg-white/5 text-slate-200">Device {clip.device_id}</span>
              <span className="pill bg-white/5 text-slate-200">{clip.duration_sec.toFixed(1)}s</span>
              {clip.frames_with_animals ? (
                <span className="pill bg-white/5 text-slate-200">{clip.frames_with_animals} frames with detections</span>
              ) : null}
            </div>

            {clip.species_counts ? (
              <div className="flex flex-wrap gap-2">
                {Object.entries(clip.species_counts).map(([species, count]) => (
                  <span
                    key={species}
                    className="text-xs bg-white/5 border border-white/10 rounded-full px-2 py-1 text-slate-200"
                  >
                    {species} · {count}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Link>
  );
}
