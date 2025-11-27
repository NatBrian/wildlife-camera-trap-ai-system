"""
Helpers for consistently naming and storing capture artifacts.
"""

from datetime import datetime
from pathlib import Path
from typing import Dict


def ensure_dir(path: Path) -> Path:
    """Create directory if needed and return the path for chaining."""
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_new_clip_paths(base_dir: Path, timestamp: datetime) -> Dict[str, Path]:
    """
    Generate file paths for the next clip artifacts using a UTC timestamp stem.
    Organizes captures by date to keep directories manageable.
    """
    date_dir = ensure_dir(base_dir / timestamp.strftime("%Y-%m-%d"))
    stem = timestamp.strftime("%Y%m%d_%H%M%S")
    video_path = date_dir / f"clip_{stem}.mp4"
    metadata_path = date_dir / f"clip_{stem}.json"
    thumbnail_path = date_dir / f"clip_{stem}.jpg"
    return {
        "video_path": video_path,
        "metadata_path": metadata_path,
        "thumbnail_path": thumbnail_path,
    }
