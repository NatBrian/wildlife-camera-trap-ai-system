import { Detection, SpeciesCounts } from "@/types";

type ClassificationResult = {
    label: string;
    score: number;
    classId: number;
};

export async function classifyRecordedClip(
    videoBlob: Blob,
    runInference: (imageData: ImageData) => Promise<Detection[]>,
    runClassifier: (imageData: ImageData) => Promise<ClassificationResult[]>,
    inputSize: number,
    classifierInputSize: number,
    onProgress?: (current: number, total: number) => void,
    timestamps?: number[]
): Promise<SpeciesCounts> {
    return new Promise((resolve, reject) => {
        const video = document.createElement("video");
        const url = URL.createObjectURL(videoBlob);
        video.src = url;
        video.muted = true;
        video.playsInline = true;

        const canvas = document.createElement("canvas");
        canvas.width = inputSize;
        canvas.height = inputSize;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        if (!ctx) {
            reject(new Error("Failed to create canvas context"));
            return;
        }

        const speciesCounts: SpeciesCounts = {};

        // If timestamps are provided, use them. Otherwise, default to 1 FPS.
        // Filter timestamps to be at least 1 second apart to avoid processing too many similar frames
        const uniqueTimestamps = timestamps
            ? [...new Set(timestamps.map(t => Math.floor(t / 1000)))].map(t => t * 1000)
            : null;

        video.onloadedmetadata = async () => {
            const duration = video.duration;

            // Determine the schedule of times to check
            const schedule: number[] = [];
            if (uniqueTimestamps && uniqueTimestamps.length > 0) {
                // Use provided timestamps (convert ms to seconds for video.currentTime)
                for (const t of uniqueTimestamps) {
                    const timeSec = t / 1000;
                    if (timeSec < duration) schedule.push(timeSec);
                }
            } else {
                // Fallback: Check every 1 second
                for (let t = 0; t < duration; t += 1) {
                    schedule.push(t);
                }
            }

            const totalFrames = schedule.length;
            console.log(`[ProcessClip] Processing ${totalFrames} frames based on ${uniqueTimestamps ? "keypoints" : "interval"}`);

            try {
                for (let i = 0; i < schedule.length; i++) {
                    const time = schedule[i];
                    video.currentTime = time;

                    // Wait for seek
                    await new Promise<void>((res) => {
                        const onSeek = () => {
                            video.removeEventListener("seeked", onSeek);
                            res();
                        };
                        video.addEventListener("seeked", onSeek);
                    });

                    // Draw frame to canvas
                    ctx.drawImage(video, 0, 0, inputSize, inputSize);
                    const imageData = ctx.getImageData(0, 0, inputSize, inputSize);

                    // 1. Run Detection (YOLO)
                    // We still need to run detection to get the bounding box for cropping
                    const detections = await runInference(imageData);

                    // Filter out people/vehicles
                    const animalDetections = detections.filter(d => d.label !== "person" && d.label !== "vehicle");

                    if (animalDetections.length > 0) {
                        console.log(`[ProcessClip] Time ${time.toFixed(2)}s: Found ${animalDetections.length} animals`);
                    }

                    // 2. For each animal, crop and classify
                    for (const det of animalDetections) {
                        // Crop logic...
                        const [x1, y1, x2, y2] = det.box;
                        // Convert normalized coords to pixel coords
                        const sx = Math.max(0, Math.floor(x1 * inputSize));
                        const sy = Math.max(0, Math.floor(y1 * inputSize));
                        const sw = Math.min(inputSize - sx, Math.floor((x2 - x1) * inputSize));
                        const sh = Math.min(inputSize - sy, Math.floor((y2 - y1) * inputSize));

                        if (sw > 10 && sh > 10) { // Minimum size check
                            const cropCanvas = document.createElement("canvas");
                            cropCanvas.width = classifierInputSize;
                            cropCanvas.height = classifierInputSize;
                            const cropCtx = cropCanvas.getContext("2d");

                            if (cropCtx) {
                                // Draw crop resized to classifier input size
                                cropCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, classifierInputSize, classifierInputSize);
                                const cropData = cropCtx.getImageData(0, 0, classifierInputSize, classifierInputSize);

                                // Run Classification
                                const results = await runClassifier(cropData);
                                if (results && results.length > 0) {
                                    const topResult = results[0];
                                    console.log(`[ProcessClip] Classified: ${topResult.label} (${topResult.score.toFixed(2)})`);

                                    // Only count if score is reasonable (e.g. > 0.4)
                                    if (topResult.score > 0.4) {
                                        const label = topResult.label;
                                        speciesCounts[label] = (speciesCounts[label] || 0) + 1;
                                    }
                                }
                            }
                        }
                    }

                    if (onProgress) onProgress(i + 1, totalFrames);
                }

                console.log("[ProcessClip] Final counts:", speciesCounts);
                resolve(speciesCounts);
            } catch (err) {
                console.error("[ProcessClip] Error:", err);
                reject(err);
            } finally {
                // Cleanup
                URL.revokeObjectURL(url);
                video.src = "";
                video.remove();
            }
        };


        video.onerror = (e) => reject(new Error("Video load error"));
    });
}

export async function classifyCapturedFrames(
    frames: { imageData: ImageData; detections: Detection[] }[],
    runClassifier: (imageData: ImageData) => Promise<ClassificationResult[]>,
    classifierInputSize: number,
    onProgress?: (current: number, total: number) => void
): Promise<SpeciesCounts> {
    const speciesCounts: SpeciesCounts = {};
    const totalFrames = frames.length;

    console.log(`[ClassifyFrames] Processing ${totalFrames} captured frames`);

    // Create a reusable canvas for cropping
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = classifierInputSize;
    cropCanvas.height = classifierInputSize;
    const cropCtx = cropCanvas.getContext("2d");

    // Create a temp canvas to hold the source ImageData so we can crop from it
    const sourceCanvas = document.createElement("canvas");
    const sourceCtx = sourceCanvas.getContext("2d");

    for (let i = 0; i < totalFrames; i++) {
        const { imageData, detections } = frames[i];

        // Filter out people/vehicles
        const animalDetections = detections.filter(d => d.label !== "person" && d.label !== "vehicle");

        if (animalDetections.length === 0) continue;

        // Put ImageData into source canvas
        if (sourceCanvas.width !== imageData.width || sourceCanvas.height !== imageData.height) {
            sourceCanvas.width = imageData.width;
            sourceCanvas.height = imageData.height;
        }
        sourceCtx?.putImageData(imageData, 0, 0);

        for (const det of animalDetections) {
            const [x1, y1, x2, y2] = det.box;

            // Coordinates are already in pixels relative to imageData size (inputSize)
            // because they come from the live inference which uses the same inputSize
            const sx = Math.max(0, Math.floor(x1));
            const sy = Math.max(0, Math.floor(y1));
            const sw = Math.min(imageData.width - sx, Math.floor(x2 - x1));
            const sh = Math.min(imageData.height - sy, Math.floor(y2 - y1));

            if (sw > 10 && sh > 10 && cropCtx && sourceCanvas) {
                // Draw crop resized to classifier input size
                cropCtx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, classifierInputSize, classifierInputSize);
                const cropData = cropCtx.getImageData(0, 0, classifierInputSize, classifierInputSize);

                // Run Classification
                try {
                    const results = await runClassifier(cropData);
                    if (results && results.length > 0) {
                        // Iterate through results to find the first non-blank label
                        let bestSpecies = null;

                        for (const result of results) {
                            const label = result.label;
                            // Skip blank/empty labels
                            if (!label || label.trim() === "" || label === "blank") {
                                continue;
                            }

                            // If we find a valid species with a reasonable score, use it
                            // We lower the threshold because the model might be uncertain between similar species
                            // or the "blank" class might be dominating the softmax.
                            if (result.score > 0.1) {
                                bestSpecies = result;
                                break;
                            }
                        }

                        if (bestSpecies) {
                            console.log(`[ClassifyFrames] Frame ${i}: Found ${bestSpecies.label} (${bestSpecies.score.toFixed(2)})`);
                            speciesCounts[bestSpecies.label] = (speciesCounts[bestSpecies.label] || 0) + 1;
                        } else {
                            // Fallback: If classifier thinks it's blank/unknown, but YOLO saw an animal,
                            // count it as the generic YOLO label (e.g. "animal")
                            console.log(`[ClassifyFrames] Frame ${i}: No specific species found, falling back to '${det.label}'`);
                            speciesCounts[det.label] = (speciesCounts[det.label] || 0) + 1;
                        }
                    }
                } catch (err) {
                    console.error(`[ClassifyFrames] Error classifying frame ${i}:`, err);
                    // Fallback on error too
                    speciesCounts[det.label] = (speciesCounts[det.label] || 0) + 1;
                }
            }
        }

        if (onProgress) onProgress(i + 1, totalFrames);
    }

    return speciesCounts;
}
