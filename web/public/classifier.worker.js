// Web Worker for SpeciesNet Classification

// Import ONNX Runtime Web from local
importScripts("/onnxruntime/ort.all.min.js");

// Global state
let session = null;
let inputName = null;
let outputNames = null;
let labels = [];
let inputSize = 224; // Default, will be updated by config

// Configure ORT to load WASM from local
ort.env.wasm.wasmPaths = "/onnxruntime/";
ort.env.wasm.numThreads = 1;

// Helper function: Softmax
function softmax(logits) {
    const maxLogit = Math.max(...logits);
    const scores = logits.map(l => Math.exp(l - maxLogit));
    const sumScores = scores.reduce((a, b) => a + b, 0);
    return scores.map(s => s / sumScores);
}

// Helper function: Image to Tensor
function imageDataToTensor(data, width, height, inputSize) {
    const floatData = new Float32Array(3 * inputSize * inputSize);

    // If dimensions match, fast path
    if (width === inputSize && height === inputSize) {
        const totalPixels = inputSize * inputSize;
        for (let i = 0; i < totalPixels; i++) {
            const base = i * 4;
            // Normalize 0-255 -> 0.0-1.0 (SpeciesNet expects 0-1 float input)
            // NHWC Layout: [R, G, B, R, G, B, ...]
            const dst = i * 3;
            floatData[dst] = data[base] / 255;     // R
            floatData[dst + 1] = data[base + 1] / 255; // G
            floatData[dst + 2] = data[base + 2] / 255; // B
        }
    } else {
        // Resize/Crop logic (simple resize for now)
        for (let y = 0; y < inputSize; y++) {
            for (let x = 0; x < inputSize; x++) {
                const srcX = Math.floor((x / inputSize) * width);
                const srcY = Math.floor((y / inputSize) * height);
                const idx = (srcY * width + srcX) * 4;

                const dst = (y * inputSize + x) * 3;
                floatData[dst] = data[idx] / 255;
                floatData[dst + 1] = data[idx + 1] / 255;
                floatData[dst + 2] = data[idx + 2] / 255;
            }
        }
    }
    return new ort.Tensor("float32", floatData, [1, inputSize, inputSize, 3]);
}

// Message Handler
self.onmessage = async (e) => {
    const { type, payload, id } = e.data;

    if (type === "load") {
        try {
            const { modelUrl, labelsUrl, config } = payload;

            if (config && config.inputSize) {
                inputSize = config.inputSize;
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

            // ort.env.wasm.wasmPaths is set at top level now

            if (!session) {
                session = await ort.InferenceSession.create(modelUrl, {
                    executionProviders,
                });
            } else {
                console.log("[ClassifierWorker] Session already loaded, reusing.");
            }

            inputName = session.inputNames[0];
            outputNames = session.outputNames;

            self.postMessage({ type: "ready", payload: { inputSize, labels }, id });
        } catch (err) {
            self.postMessage({ type: "error", payload: err.message, id });
        }
    } else if (type === "classify") {
        if (!session) {
            self.postMessage({ type: "error", payload: "Model not loaded", id });
            return;
        }

        try {
            const { data, width, height } = payload;
            console.log(`[ClassifierWorker] Received image: ${width}x${height}`);
            const tensor = imageDataToTensor(data, width, height, inputSize);

            const outputs = await session.run({ [inputName]: tensor });
            const output = outputs[outputNames[0]];

            // Post-process
            const logits = Array.from(output.data);
            console.log(`[ClassifierWorker] Logits length: ${logits.length}, First few: ${logits.slice(0, 5)}`);

            const probs = softmax(logits);
            console.log(`[ClassifierWorker] Probs length: ${probs.length}, First few: ${probs.slice(0, 5)}`);

            // Get top 5 results
            const topK = 5;
            const sortedIndices = probs
                .map((prob, idx) => ({ prob, idx }))
                .sort((a, b) => b.prob - a.prob)
                .slice(0, topK);

            const results = sortedIndices.map(item => ({
                label: labels[item.idx] || `class_${item.idx}`,
                score: item.prob,
                classId: item.idx
            }));

            console.log(`[ClassifierWorker] Top result: ${results[0]?.label} (${results[0]?.score.toFixed(4)})`);

            self.postMessage({ type: "result", payload: results, id });
        } catch (err) {
            console.error("[ClassifierWorker] Error:", err);
            self.postMessage({ type: "error", payload: err.message, id });
        }
    }
};
