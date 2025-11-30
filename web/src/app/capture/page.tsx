import type { Metadata } from "next";
import Link from "next/link";

import CameraCapture from "@/components/CameraCapture";

export const metadata: Metadata = {
  title: "Browser Capture",
  description: "Run YOLO in the browser, record clips, and upload to Supabase.",
};

export default function CapturePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Capture</p>
          <h1 className="text-2xl font-semibold text-mint">Camera + YOLO (client only)</h1>
          <p className="text-sm text-slate-300">
            Requests camera access, runs ONNXRuntime Web, overlays detections, and records via MediaRecorder.
          </p>
        </div>
        <Link href="/" className="text-mint hover:underline text-sm">
          ← Back to clips
        </Link>
      </div>

      <CameraCapture />

      <div className="glass rounded-xl p-4 border border-white/10 text-sm text-slate-200 space-y-2">
        <p className="font-semibold text-mint">Instructions</p>
        <p>
          Ensure camera permissions are enabled. The system will automatically detect animals and record clips when they enter the frame.
        </p>
      </div>
    </div>
  );
}
