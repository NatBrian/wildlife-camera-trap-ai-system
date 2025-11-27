"""
Stateful recorder that starts/stops clips based on YOLO detections.
Avoids rapid start/stop jitter by waiting for a silence timeout before closing a clip.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional

import cv2

from notifier import Notifier
from supabase_client import SupabaseClient
from utils.paths import get_new_clip_paths, ensure_dir


class Recorder:
    """
    Maintains recording state machine.
    - Start when at least one detection is present.
    - Keep writing frames until `no_animal_timeout_sec` of silence elapses.
    """

    def __init__(
        self,
        output_dir: Path,
        device_id: str,
        no_animal_timeout_sec: int,
        notifier: Notifier,
        supabase_client: SupabaseClient,
        fps: float = 20.0,
        thumbnail_quality: int = 85,
    ) -> None:
        self.output_dir = ensure_dir(output_dir)
        self.device_id = device_id
        self.no_animal_timeout_sec = no_animal_timeout_sec
        self.notifier = notifier
        self.supabase_client = supabase_client
        self.fps = fps or 20.0
        self.thumbnail_quality = thumbnail_quality

        self.recording = False
        self.video_writer: Optional[cv2.VideoWriter] = None
        self.clip_paths: Dict[str, Path] = {}
        self.species_counts: Dict[str, int] = defaultdict(int)
        self.frames_with_animals = 0
        self.last_seen_time: Optional[datetime] = None
        self.clip_start_time: Optional[datetime] = None
        self.thumbnail_frame = None
        self.last_frame = None

    def process_frame(self, frame, species_counts: Dict[str, int]) -> None:
        """
        Main loop entrypoint. Called once per frame.
        Decides when to start/stop recording based on detections.
        """
        now = datetime.now(timezone.utc)
        has_animals = bool(species_counts)
        self.last_frame = frame

        if has_animals:
            self.last_seen_time = now
            if not self.recording:
                self._start_clip(now, frame)
            self.frames_with_animals += 1
            self.thumbnail_frame = frame.copy() if self.thumbnail_frame is None else self.thumbnail_frame

        if self.recording:
            self.video_writer.write(frame)
            for species, count in species_counts.items():
                self.species_counts[species] = max(self.species_counts.get(species, 0), count)

        if self.recording and not has_animals and self.last_seen_time:
            silence = (now - self.last_seen_time).total_seconds()
            if silence > self.no_animal_timeout_sec:
                self._stop_clip()

    def close(self) -> None:
        """Stop any ongoing recording when shutting down cleanly."""
        if self.recording:
            self._stop_clip()

    def _start_clip(self, now: datetime, frame) -> None:
        self.clip_paths = get_new_clip_paths(self.output_dir, now)
        height, width = frame.shape[:2]
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        self.video_writer = cv2.VideoWriter(
            str(self.clip_paths["video_path"]),
            fourcc,
            self.fps,
            (width, height),
        )
        self.recording = True
        self.clip_start_time = now
        self.last_seen_time = now
        self.species_counts = defaultdict(int)
        self.frames_with_animals = 0
        self.thumbnail_frame = None
        logging.info("Started recording clip %s", self.clip_paths["video_path"].name)

    def _stop_clip(self) -> None:
        end_time = self.last_seen_time or datetime.now(timezone.utc)
        if self.video_writer:
            self.video_writer.release()
        self.recording = False

        if not self.clip_start_time:
            logging.warning("Tried to stop clip without start time; skipping save")
            return

        duration_sec = (end_time - self.clip_start_time).total_seconds()
        metadata = {
            "video_filename": self.clip_paths["video_path"].name,
            "local_video_path": str(self.clip_paths["video_path"]),
            "start_time_utc": self.clip_start_time.isoformat(),
            "end_time_utc": end_time.isoformat(),
            "duration_sec": duration_sec,
            "device_id": self.device_id,
            "species_counts": dict(self.species_counts),
            "frames_with_animals": self.frames_with_animals,
        }

        self._write_metadata(metadata)
        self._write_thumbnail()

        # Fire-and-forget best-effort notifications/cloud sync.
        self.notifier.send_new_clip_notification(metadata)
        self.supabase_client.insert_clip_metadata(metadata, self.clip_paths.get("thumbnail_path"))

        logging.info(
            "Finished clip %s (%.1fs, %s)",
            metadata["video_filename"],
            duration_sec,
            metadata.get("species_counts"),
        )

        # Reset state.
        self.video_writer = None
        self.clip_paths = {}
        self.species_counts = defaultdict(int)
        self.frames_with_animals = 0
        self.clip_start_time = None
        self.thumbnail_frame = None
        self.last_frame = None

    def _write_metadata(self, metadata: Dict) -> None:
        ensure_dir(self.clip_paths["metadata_path"].parent)
        with open(self.clip_paths["metadata_path"], "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2)

    def _write_thumbnail(self) -> None:
        # Prefer a frame that had detections; fall back to last frame.
        frame = self.thumbnail_frame if self.thumbnail_frame is not None else self.last_frame
        if frame is None:
            return
        ensure_dir(self.clip_paths["thumbnail_path"].parent)
        cv2.imwrite(
            str(self.clip_paths["thumbnail_path"]),
            frame,
            [int(cv2.IMWRITE_JPEG_QUALITY), int(self.thumbnail_quality)],
        )
