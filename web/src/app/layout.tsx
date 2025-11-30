import Link from "next/link";
import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "@/styles/globals.css";

const space = Space_Grotesk({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Wildlife Camera Trap",
  description: "Lightweight web UI for viewing camera-trap clips",
};

import Script from "next/script";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${space.className} bg-night text-slate-100`}>
        <Script src="/onnxruntime/ort.all.min.js" strategy="beforeInteractive" />
        <div className="min-h-screen">
          <header className="border-b border-white/10 sticky top-0 z-20 backdrop-blur bg-night/80">
            <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-6">
              <div className="flex items-center gap-6">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Wildlife Camera Trap</p>
                  <h1 className="text-2xl font-semibold text-mint">Clips & Detections</h1>
                </div>
                <nav className="flex gap-2 text-sm">
                  <Link href="/" className="px-3 py-1 rounded-lg border border-white/10 text-slate-200 hover:border-white/40">
                    Viewer
                  </Link>
                  <Link href="/capture" className="px-3 py-1 rounded-lg border border-white/10 text-slate-200 hover:border-white/40">
                    Capture
                  </Link>
                </nav>
              </div>
              <div className="text-right text-sm text-slate-300">
                <p>Wildlife Camera Trap System</p>
                <p className="text-xs text-slate-400">Powered by YOLOv8 & SpeciesNet</p>
              </div>
            </div>
          </header>
          <main className="max-w-6xl mx-auto px-4 pb-12 pt-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
