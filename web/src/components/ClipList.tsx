import ClipCard from "./ClipCard";
import { Clip } from "@/types";

type Props = {
  clips: Clip[];
};

export default function ClipList({ clips }: Props) {
  if (!clips.length) {
    return (
      <div className="glass rounded-2xl p-6 text-slate-300 border border-white/10">
        No clips yet. Once the edge app records detections, metadata will appear here.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      {clips.map((clip) => (
        <ClipCard key={clip.id} clip={clip} />
      ))}
    </div>
  );
}
