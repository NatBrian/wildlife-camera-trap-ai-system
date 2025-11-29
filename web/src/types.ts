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

export type SpeciesCounts = Record<string, number>;

export type Detection = {
  box: [number, number, number, number]; // [x1, y1, x2, y2] in input resolution
  score: number;
  classId: number;
  label: string;
};

export type ClipUploadPayload = {
  device_id: string;
  started_at: string;
  ended_at: string;
  duration_sec: number;
  primary_species: string | null;
  max_animals: number;
  species_counts: SpeciesCounts;
  frames_with_animals: number;
  thumbnail_url?: string | null;
  local_video_path?: string | null;
  thumbnail_path?: string | null;
  video_path?: string | null;
};
