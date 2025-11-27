"""
YOLOv8-based animal detector wrapper.
Keeps the model concerns isolated from the recorder loop.
"""

from collections import defaultdict
from typing import Dict, List, Tuple

from ultralytics import YOLO


class YoloDetector:
    """Thin wrapper around a YOLOv8 model to return structured detections."""

    def __init__(
        self,
        model_path: str,
        conf_threshold: float = 0.35,
        target_classes: List[str] | None = None,
    ) -> None:
        self.model = YOLO(model_path)
        # Use model-provided labels; YOLO stores names on the model.
        self.class_names = getattr(self.model, "names", None) or getattr(
            getattr(self.model, "model", None), "names", {}
        )
        self.conf_threshold = conf_threshold
        self.target_classes = set(target_classes or [])

    def detect(self, frame) -> Tuple[List[Dict], Dict[str, int]]:
        """
        Run inference on a frame and return both raw detections and per-species counts.
        The per-species counts are used by the recorder to decide start/stop.
        """
        results = self.model(frame, verbose=False, conf=self.conf_threshold)
        if not results:
            return [], {}

        result = results[0]
        detections: List[Dict] = []
        species_counts: Dict[str, int] = defaultdict(int)

        for box in result.boxes:
            cls_id = int(box.cls[0])
            species = self.class_names.get(cls_id, str(cls_id))
            if self.target_classes and species not in self.target_classes:
                continue

            confidence = float(box.conf[0])
            x1, y1, x2, y2 = [float(v) for v in box.xyxy[0]]
            species_counts[species] += 1
            detections.append(
                {
                    "species": species,
                    "confidence": confidence,
                    "box": [x1, y1, x2, y2],
                }
            )

        return detections, dict(species_counts)
