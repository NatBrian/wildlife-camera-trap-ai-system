# Wildlife Camera-Trap System (edge + web)

End-to-end, free-tier-friendly setup for capturing animal clips on-device and browsing metadata in a Next.js app backed by Supabase.

## Project structure

```
.
├── infra/
│   ├── supabase_schema.sql        # clips table + indexes + RLS
│   └── .env.example               # Supabase keys/bucket names (copy to real env files)
├── edge/                          # Python capture app (runs near camera)
│   ├── config.example.yaml
│   ├── .env.example
│   ├── requirements.txt
│   ├── main.py                    # orchestrates capture loop
│   ├── detection.py               # YOLO wrapper
│   ├── recorder.py                # start/stop logic, writes mp4/json/jpg
│   ├── notifier.py                # Telegram/Discord
│   ├── supabase_client.py         # metadata + thumbnail upload
│   └── utils/paths.py
└── web/                           # Next.js App Router UI (deploy to Vercel)
    ├── package.json
    ├── next.config.mjs
    ├── tailwind.config.mjs
    ├── postcss.config.mjs
    ├── tsconfig.json
    ├── .env.example
    └── src/
        ├── app/
        │   ├── layout.tsx
        │   ├── page.tsx            # list + filters
        │   └── clips/[id]/page.tsx # detail view
        ├── components/
        │   ├── ClipCard.tsx
        │   ├── ClipFilters.tsx
        │   └── ClipList.tsx
        ├── lib/supabaseClient.ts
        ├── styles/globals.css
        └── types.ts
```

## Supabase (free tier)

1) Create a Supabase project.  
2) In the SQL editor, run `infra/supabase_schema.sql`. This creates the `clips` table, indexes, and read-only RLS for anon clients.  
3) Create a public storage bucket named `thumbnails` (or your choice) for small JPEGs; mark it public so URLs are fetchable by the web app.  
4) Grab keys/URLs:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (edge insert + storage; never expose to frontend)
   - `SUPABASE_ANON_KEY` (frontend read-only)
5) Set environment values:
   - Edge: copy `edge/.env.example` → `edge/.env`, fill `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, optionally `SUPABASE_FOLDER`.
   - Web: copy `web/.env.example` → `web/.env.local`, fill `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET`.

## Notifications (Telegram or Discord, free)

- **Telegram**: Use `@BotFather` to create a bot → get token. Get your chat ID (via `@userinfobot` or a simple test bot). Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (env or `config.yaml`).  
- **Discord**: In any channel, create a webhook and set `DISCORD_WEBHOOK_URL`.  
- Toggle provider in `edge/config.yaml` under `notifications`.

## Edge app (Python capture)

1) `cd edge && cp config.example.yaml config.yaml` then adjust:
   - `camera_source`: webcam index (0) or RTSP URL.
   - `model_path`: YOLO weights (e.g., `./models/best.pt`).
   - `output_dir`: where mp4/json/jpg are stored locally.
   - `device_id`: any label for this device.
   - `no_animal_timeout_sec`: seconds with no detections before stopping a clip.
   - Notification + Supabase sections as needed.
2) `cp .env.example .env` and fill Supabase + notification secrets.  
3) Install deps: `pip install -r requirements.txt` (Python 3.9+).  
4) Run: `python main.py --config config.yaml`.  
   - For local test footage (instead of a live camera), use `python main.py --config config.yaml --video ./animal_clip.mp4` and add `--loop-video` to restart when the file ends.  
   - The recorder starts on the first detection, stops after `no_animal_timeout_sec` of silence, writes `.mp4`, `.json`, `.jpg`, sends a notification, and (optionally) uploads metadata + thumbnail to Supabase. Heavy video files stay local.

## Web app (Next.js + Vercel free tier)

1) `cd web && cp .env.example .env.local` and fill Supabase public URL/anon key/bucket.  
2) Install deps: `npm install`.  
3) Run locally: `npm run dev` then open `http://localhost:3000`.  
4) Deploy: push the repo to GitHub, connect to Vercel, set env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET`). The app reads metadata only; anon key remains read-only thanks to RLS.

## Notes & design choices

- Free-tier friendly: videos never leave the device; only JSON metadata + tiny JPEGs hit Supabase.  
- Supabase RLS: enabled with public select; inserts happen with the service role key on the edge device (bypasses RLS).  
- YOLO model path is configurable; use a small model (e.g., YOLOv8n) for speed on modest hardware.  
- Storage layout is simple (`captures/clip_YYYYMMDD_HHMMSS.{mp4,json,jpg}`) for easy syncing/backups.

## Quick reference commands

```bash
# Edge
pip install -r edge/requirements.txt
python edge/main.py --config edge/config.yaml

# Web
cd web
npm install
npm run dev
```
