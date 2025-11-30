let iouThreshold = 0.45;
let topk = 50;

// Helper functions
function clamp(v, min, max) {
    return Math.min(Math.max(v, min), max);
}

function xywhToXyxy(x, y, w, h) {
    const x1 = x - w / 2;
    const y1 = y - h / 2;
    const x2 = x + w / 2;
    const y2 = y + h / 2;
    return [x1, y1, x2, y2];
}

function iou(a, b) {
    const x1 = Math.max(a[0], b[0]);
    const y1 = Math.max(a[1], b[1]);
    const x2 = Math.min(a[2], b[2]);
    const y2 = Math.min(a[3], b[3]);
    const interArea = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
    const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
    const union = areaA + areaB - interArea;
    return union <= 0 ? 0 : interArea / union;
}

function nonMaxSuppression(detections, iouThreshold) {
    const sorted = [...detections].sort((a, b) => b.score - a.score);
    const results = [];

    while (sorted.length) {
        const current = sorted.shift();
        results.push(current);
        const remaining = [];
        for (const det of sorted) {
            if (iou(current.box, det.box) < iouThreshold) {
                remaining.push(det);
            }
        }
        sorted.splice(0, sorted.length, ...remaining);
    }

    return results;
}

function decodeDetections(output, labels, confThreshold, iouThreshold, topk, inputSize) {
    const dims = output.dims;
    const data = output.data;

    if (!dims.length) return [];

    let anchors = 0;
    let values = 0;
    let channelsFirst = false;

    // Handle YOLOv10 format: [1, 300, 6] -> [x1, y1, x2, y2, score, class]
    if (dims.length === 3 && dims[2] === 6) {
        const numDetections = dims[1];
        const detections = [];
        for (let i = 0; i < numDetections; i++) {
            const base = i * 6;
            const x1 = data[base];
            const y1 = data[base + 1];
            const x2 = data[base + 2];
            const y2 = data[base + 3];
            const score = data[base + 4];
            const classId = data[base + 5];

            if (score < confThreshold) continue;

            detections.push({
                box: [
                    clamp(x1, 0, inputSize),
                    clamp(y1, 0, inputSize),
                    clamp(x2, 0, inputSize),
                    clamp(y2, 0, inputSize),
                ],
                score: score,
                classId: classId,
                label: labels[classId] || `class_${classId}`,
            });
        }
        return detections.sort((a, b) => b.score - a.score).slice(0, topk);
    }

    // Handle both (1, channels, anchors) and (1, anchors, values) layouts.
    if (dims.length === 3) {
        if (dims[1] > dims[2]) {
            // [1, anchors, values]
            anchors = dims[1];
            values = dims[2];
            channelsFirst = false;
        } else {
            // [1, values, anchors]
            anchors = dims[2];
            values = dims[1];
            channelsFirst = true;
        }
    } else if (dims.length === 2) {
        anchors = dims[0];
        values = dims[1];
    } else {
        return [];
    }

    const numClasses = values - 4;
    const detections = [];

    for (let i = 0; i < anchors; i += 1) {
        let x = 0;
        let y = 0;
        let w = 0;
        let h = 0;
        let bestClass = -1;
        let bestScore = 0;

        if (channelsFirst) {
            x = data[i];
            y = data[anchors + i];
            w = data[2 * anchors + i];
            h = data[3 * anchors + i];
            for (let c = 0; c < numClasses; c += 1) {
                const score = data[(4 + c) * anchors + i];
                if (score > bestScore) {
                    bestScore = score;
                    bestClass = c;
                }
            }
        } else {
            const base = i * values;
            x = data[base];
            y = data[base + 1];
            w = data[base + 2];
            h = data[base + 3];
            for (let c = 0; c < numClasses; c += 1) {
                const score = data[base + 4 + c];
                if (score > bestScore) {
                    bestScore = score;
                    bestClass = c;
                }
            }
        }

        if (bestClass === -1 || bestScore < confThreshold) continue;

        const [x1, y1, x2, y2] = xywhToXyxy(x, y, w, h);
        detections.push({
            box: [
                clamp(x1, 0, inputSize),
                clamp(y1, 0, inputSize),
                clamp(x2, 0, inputSize),
                clamp(y2, 0, inputSize),
            ],
            score: bestScore,
            classId: bestClass,
            label: labels[bestClass] || `class_${bestClass}`,
        });
    }

    return nonMaxSuppression(detections, iouThreshold).slice(0, topk);
}

let tensorBuffer = null;

function imageDataToTensor(data, width, height, inputSize) {
    const totalPixels = inputSize * inputSize;
    const tensorSize = 3 * totalPixels;

    // Re-allocate buffer if needed (size changed or not initialized)
    if (!tensorBuffer || tensorBuffer.length !== tensorSize) {
        tensorBuffer = new Float32Array(tensorSize);
    }

    const floatData = tensorBuffer;

    // Optimization: If image dimensions match inputSize, iterate linearly.
    if (width === inputSize && height === inputSize) {
        for (let i = 0; i < totalPixels; i++) {
            const base = i * 4;
            // Normalize 0-255 -> 0.0-1.0
            const r = data[base] / 255;
            const g = data[base + 1] / 255;
            const b = data[base + 2] / 255;

            // NCHW Layout: RRR...GGG...BBB...
            floatData[i] = r;
            floatData[totalPixels + i] = g;
            floatData[2 * totalPixels + i] = b;
        }
    } else {
        // Fallback for mismatched dimensions
        for (let y = 0; y < inputSize; y += 1) {
            for (let x = 0; x < inputSize; x += 1) {
                const srcX = Math.floor((x / inputSize) * width);
                const srcY = Math.floor((y / inputSize) * height);
                const idx = (srcY * width + srcX) * 4;
                const r = data[idx] / 255;
                const g = data[idx + 1] / 255;
                const b = data[idx + 2] / 255;
                const dst = y * inputSize + x;
                floatData[dst] = r;
                floatData[inputSize * inputSize + dst] = g;
                floatData[2 * inputSize * inputSize + dst] = b;
            }
        }
    }
    return new ort.Tensor("float32", floatData, [1, 3, inputSize, inputSize]);
}

// Message Handler
self.onmessage = async (e) => {
    const { type, payload, id } = e.data;

    if (type === "load") {
        try {
            const { modelUrl, labelsUrl, config } = payload;

            if (config) {
                if (config.inputSize) inputSize = config.inputSize;
                if (config.confThreshold) confThreshold = config.confThreshold;
                if (config.iouThreshold) iouThreshold = config.iouThreshold;
                if (config.topk) topk = config.topk;
            }

            // Load Labels
            if (labelsUrl) {
                const res = await fetch(labelsUrl);
                if (res.ok) {
                    labels = await res.json();
                }
            }

            // Load Model
            const executionProviders = ["wasm"];
            if (payload.preferBackend === "webgpu" && typeof navigator !== "undefined" && navigator.gpu) {
                executionProviders.unshift("webgpu");
            }

            // Configure WASM paths
            ort.env.wasm.wasmPaths = "/onnxruntime/";

            session = await ort.InferenceSession.create(modelUrl, {
                executionProviders,
            });

            inputName = session.inputNames[0];
            outputNames = session.outputNames;

            self.postMessage({ type: "ready", payload: { inputSize, labels }, id });
        } catch (err) {
            self.postMessage({ type: "error", payload: err.message, id });
        }
    } else if (type === "detect") {
        if (!session) {
            self.postMessage({ type: "error", payload: "Model not loaded", id });
            return;
        }

        try {
            const { data, width, height } = payload; // ImageData-like object
            const tensor = imageDataToTensor(data, width, height, inputSize);

            const outputs = await session.run({ [inputName]: tensor });
            const firstOutput = outputs[outputNames[0]];

            const detections = decodeDetections(firstOutput, labels, confThreshold, iouThreshold, topk, inputSize);

            self.postMessage({ type: "result", payload: detections, id });
        } catch (err) {
            self.postMessage({ type: "error", payload: err.message, id });
        }
    }
};
