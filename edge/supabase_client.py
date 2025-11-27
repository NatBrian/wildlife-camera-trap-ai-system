"""
Supabase client wrapper for inserting clip metadata and (optionally) thumbnails.
Only lightweight data is pushed; raw mp4 stays local on the edge device.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Dict, Optional

from supabase import Client, create_client


class SupabaseClient:
    def __init__(self, config: Dict) -> None:
        self.enabled = bool(config.get("enabled", False))
        self.bucket = config.get("bucket") or os.getenv("SUPABASE_STORAGE_BUCKET")
        self.folder = config.get("folder") or os.getenv("SUPABASE_FOLDER", "clips")

        url = os.getenv("SUPABASE_URL") or config.get("url")
        key = (
            os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            or config.get("service_role_key")
            or config.get("key")
        )
        self.client: Optional[Client] = None

        if self.enabled and url and key:
            self.client = create_client(url, key)
        elif self.enabled:
            logging.warning(
                "Supabase enabled but missing URL or service role key; set env vars or config values."
            )

    def insert_clip_metadata(self, clip_metadata: Dict, thumbnail_path: Optional[Path]) -> None:
        """Upload thumbnail (if configured) and insert metadata row."""
        if not self.enabled or not self.client:
            return

        thumbnail_url = None
        if thumbnail_path and self.bucket and Path(thumbnail_path).exists():
            thumbnail_url = self._upload_thumbnail(Path(thumbnail_path))

        species_counts = clip_metadata.get("species_counts") or {}
        primary_species = max(species_counts, key=species_counts.get) if species_counts else None
        max_animals = max(species_counts.values()) if species_counts else 0

        row = {
            "device_id": clip_metadata.get("device_id"),
            "started_at": clip_metadata.get("start_time_utc"),
            "ended_at": clip_metadata.get("end_time_utc"),
            "duration_sec": clip_metadata.get("duration_sec"),
            "primary_species": primary_species,
            "max_animals": max_animals,
            "species_counts": species_counts,
            "frames_with_animals": clip_metadata.get("frames_with_animals", 0),
            "thumbnail_url": thumbnail_url,
            "local_video_path": clip_metadata.get("local_video_path"),
        }

        try:
            self.client.table("clips").insert(row).execute()
        except Exception as exc:  # noqa: BLE001 - best-effort sync
            logging.warning("Failed to insert metadata into Supabase: %s", exc)

    def _upload_thumbnail(self, thumbnail_path: Path) -> Optional[str]:
        """Upload thumbnail to Supabase storage and return a public URL."""
        if not self.client or not self.bucket:
            return None

        storage_path = f"{self.folder}/{thumbnail_path.name}"
        # Supabase storage client expects header values to be strings; ensure upsert is passed as "true".
        upload_options = {"content-type": "image/jpeg", "upsert": "true"}
        with open(thumbnail_path, "rb") as file_obj:
            try:
                self.client.storage.from_(self.bucket).upload(storage_path, file_obj, upload_options)
            except Exception as exc:  # noqa: BLE001
                logging.warning("Failed to upload thumbnail: %s", exc)
                return None

        return self.client.storage.from_(self.bucket).get_public_url(storage_path)
