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
        <p className="font-semibold text-mint">Model files</p>
        <p>
          Place an ONNX export (e.g., best.onnx) and a labels JSON under <code>/public/models</code>. The hook loads
          <code>/models/best.onnx</code> and <code>/models/labels.json</code> by default.
        </p>
        <p>
          For uploads, ensure your Supabase bucket allows anon writes (or use signed URLs/RPC) and that the
          <code>clips</code> table has an insert policy for anon users if you keep direct inserts.
        </p>
      </div>
    </div>
  );
}
