export type Clip = {
  id: string;
  device_id: string;
  started_at: string;
  ended_at: string;
  duration_sec: number;
  primary_species: string | null;
  max_animals: number | null;
  species_counts: Record<string, number> | null;
  frames_with_animals?: number | null;
  thumbnail_url?: string | null;
  local_video_path?: string | null;
  created_at?: string;
};
