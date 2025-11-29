-- Supabase schema for lightweight clip metadata and thumbnails only.
-- Heavy video files stay on the edge device.

-- UUID generation for primary keys.
create extension if not exists "pgcrypto";

-- Core metadata table.
create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  device_id text not null, -- camera or edge node identifier
  started_at timestamptz not null, -- UTC start of clip
  ended_at timestamptz not null, -- UTC end of clip
  duration_sec double precision not null, -- precomputed for easy filtering
  primary_species text, -- species with highest count in this clip
  max_animals integer, -- peak count of animals across frames
  species_counts jsonb not null, -- full dict: species -> max count
  frames_with_animals integer default 0, -- frames that had at least one detection
  thumbnail_url text, -- public URL in Supabase storage (small image only)
  local_video_path text, -- where the full mp4 lives on the edge device
  created_at timestamptz not null default now()
);

-- Helpful indexes for filters and recent ordering.
create index if not exists clips_primary_species_idx on public.clips (primary_species);
create index if not exists clips_started_at_idx on public.clips (started_at desc);

-- Row Level Security: public read-only, inserts via service role (bypasses RLS).
alter table public.clips enable row level security;
create policy if not exists "Public read access" on public.clips
  for select using (true);
-- No insert/update/delete policy needed because service role bypasses RLS; keep anon read-only.

-- Optional: create a storage bucket named "clips" in the Supabase UI
-- and mark it as public so the Next.js app can render images via URL.


-- replace the existing policy

-- drop policy if exists "Public read clips" on storage.objects;

-- create policy "Public read clips"
-- on storage.objects
-- for select
-- to public
-- using (bucket_id = 'clips');
