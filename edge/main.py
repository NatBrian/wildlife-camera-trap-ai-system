"""
Entry point for the edge capture loop.
Loads config, initializes YOLO, and orchestrates detection/recording.
"""

from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path

import cv2
import yaml
from dotenv import load_dotenv

from detection import YoloDetector
from notifier import Notifier
from recorder import Recorder
from supabase_client import SupabaseClient


def load_config(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    return _expand_env_vars(raw)


def _expand_env_vars(value):
    """Recursively expand ${VARS} inside config values using current environment."""
    if isinstance(value, str):
        return os.path.expandvars(value)
    if isinstance(value, dict):
        return {k: _expand_env_vars(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_expand_env_vars(v) for v in value]
    return value


def setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(message)s",
    )


def run(config_path: Path, video_path: Path | None = None, loop_video: bool = False) -> None:
    load_dotenv()
    config = load_config(config_path)
    setup_logging(config.get("logging", {}).get("level", "INFO"))

    camera_source = str(video_path) if video_path else config.get("camera_source", 0)
    model_path = config.get("model_path")
    output_dir = Path(config.get("output_dir", "./captures"))
    device_id = config.get("device_id", "device-unknown")
    timeout_sec = int(config.get("no_animal_timeout_sec", 5))
    min_conf = float(config.get("min_confidence", 0.35))
    target_classes = config.get("target_classes") or []
    thumbnail_quality = int(config.get("thumbnail_quality", 85))

    if not model_path:
        raise RuntimeError("model_path missing in config.yaml")

    notifier = Notifier(config.get("notifications", {}) or {})
    supabase_client = SupabaseClient(config.get("supabase", {}) or {})
    detector = YoloDetector(model_path, conf_threshold=min_conf, target_classes=target_classes)

    if video_path and not video_path.exists():
        raise RuntimeError(f"Video file not found: {video_path}")

    cap = cv2.VideoCapture(camera_source)
    if not cap.isOpened():
        raise RuntimeError(f"Unable to open camera source: {camera_source}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 20.0
    recorder = Recorder(
        output_dir=output_dir,
        device_id=device_id,
        no_animal_timeout_sec=timeout_sec,
        notifier=notifier,
        supabase_client=supabase_client,
        fps=fps,
        thumbnail_quality=thumbnail_quality,
    )

    logging.info(
        "Capture loop started (device_id=%s, source=%s%s)",
        device_id,
        camera_source,
        " [loop]" if video_path and loop_video else "",
    )
    frames_read = 0
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                if video_path and loop_video and frames_read > 0:
                    logging.info("Reached end of test video; looping from start")
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                logging.warning("Failed to read frame; stopping loop")
                break

            frames_read += 1
            _, species_counts = detector.detect(frame)
            recorder.process_frame(frame, species_counts)
    except KeyboardInterrupt:
        logging.info("Interrupted by user; shutting down.")
    finally:
        recorder.close()
        cap.release()
        logging.info("Capture loop ended.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Wildlife camera-trap edge capture loop")
    parser.add_argument("--config", type=Path, default=Path("edge/config.yaml"), help="Path to config.yaml")
    parser.add_argument(
        "--video",
        type=Path,
        help="Path to a local video file for testing; overrides camera_source in config.yaml",
    )
    parser.add_argument(
        "--loop-video",
        action="store_true",
        help="When set with --video, restart from the beginning after reaching the end of the file",
    )
    args = parser.parse_args()
    run(args.config, video_path=args.video, loop_video=args.loop_video)
