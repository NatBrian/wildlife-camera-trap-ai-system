"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type * as ort from "onnxruntime-web";

declare global {
    interface Window {
        ort: typeof ort;
    }
}

type ClassifierOptions = {
    modelUrl: string;
    labelsUrl?: string;
    inputSize?: number;
    topK?: number;
    preferBackend?: "webgpu" | "wasm";
};

type ClassificationResult = {
    label: string;
    score: number;
    classId: number;
};

type UseClassifierResult = {
    ready: boolean;
    error: string | null;
    runClassifier: (image: ImageData) => Promise<ClassificationResult[]>;
};

export function useClassifier(options: ClassifierOptions): UseClassifierResult {
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [labels, setLabels] = useState<string[]>([]);
    const sessionRef = useRef<ort.InferenceSession | null>(null);
    const ortRef = useRef<typeof import("onnxruntime-web")>();
    const inputNameRef = useRef<string>("input");

    const inputSize = options.inputSize ?? 224;

    useEffect(() => {
        let canceled = false;
        setReady(false);

        async function load() {
            if (!options.modelUrl) {
                console.log("[Classifier Load] No model URL provided");
                return;
            }

            console.log("[Classifier Load] Starting load for:", options.modelUrl);
            try {
                // Ensure ORT is loaded
                if (typeof window !== "undefined" && !window.ort) {
                    console.log("[Classifier Load] ONNX Runtime not found, loading...");
                    const src = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.all.min.js";
                    const existing = document.querySelector(`script[src="${src}"]`);

                    if (existing) {
                        console.log("[Classifier Load] ORT script exists, waiting for it...");
                        // Script exists but ort not ready yet, poll for it
                        await new Promise<void>((resolve) => {
                            const check = () => {
                                if (window.ort) resolve();
                                else setTimeout(check, 100);
                            };
                            check();
                        });
                    } else {
                        console.log("[Classifier Load] Loading ORT script...");
                        // Load it ourselves
                        await new Promise((resolve, reject) => {
                            const script = document.createElement("script");
                            script.src = src;
                            script.onload = () => resolve(undefined);
                            script.onerror = () => reject(new Error("Failed to load onnxruntime-web"));
                            document.head.appendChild(script);
                        });
                    }
                }

                const ort = window.ort;
                ortRef.current = ort;
                console.log("[Classifier Load] ORT ready, creating session...");

                const executionProviders: string[] = [];
                if (options.preferBackend === "webgpu" && typeof navigator !== "undefined" && "gpu" in navigator) {
                    executionProviders.push("webgpu");
                }
                executionProviders.push("wasm");

                console.log("[Classifier Load] Execution providers:", executionProviders);
                console.log("[Classifier Load] Creating inference session...");

                const session = await ort.InferenceSession.create(options.modelUrl, {
                    executionProviders,
                });

                if (canceled) {
                    console.log("[Classifier Load] Load canceled");
                    return;
                }

                sessionRef.current = session;
                inputNameRef.current = session.inputNames[0];
                console.log("[Classifier Load] ✅ Session created! Input:", session.inputNames[0], "Output:", session.outputNames[0]);
                setReady(true);
                console.log("[Classifier Load] ✅ Classifier is now READY");
            } catch (err) {
                if (canceled) return;
                console.error("[Classifier Load] ❌ Error loading model:", err);
                setError((err as Error)?.message || "Failed to load classifier");
            }
        }

        async function loadLabels() {
            if (!options.labelsUrl) {
                console.log("[Classifier Labels] No labels URL provided");
                return;
            }

            console.log("[Classifier Labels] Loading from:", options.labelsUrl);
            try {
                const res = await fetch(options.labelsUrl);
                if (!res.ok) throw new Error(`Failed to fetch labels: ${res.statusText}`);
                const data = (await res.json()) as string[];
                console.log("[Classifier Labels] ✅ Loaded", data.length, "labels");
                if (!canceled) setLabels(data);
            } catch (err) {
                console.error("[Classifier Labels] ❌ Error loading labels:", err);
                if (!canceled) setError((err as Error)?.message || "Failed to load classifier labels");
            }
        }

        load();
        loadLabels();

        return () => {
            canceled = true;
        };
    }, [options.modelUrl, options.labelsUrl, options.preferBackend]);

    const runClassifier = useCallback(
        async (image: ImageData): Promise<ClassificationResult[]> => {
            if (!sessionRef.current || !ortRef.current) throw new Error("Classifier not ready");

            console.log("[Classifier] Creating tensor from image:", image.width, "x", image.height);
            const tensor = imageDataToTensor(image, inputSize, ortRef.current.Tensor);
            console.log("[Classifier] Tensor shape:", tensor.dims, "| data range sample:",
                tensor.data[0], tensor.data[1000], tensor.data[10000]);

            const feeds = { [inputNameRef.current]: tensor };
            console.log("[Classifier] Running inference with input:", inputNameRef.current);
            const outputs = await sessionRef.current.run(feeds);
            const output = outputs[sessionRef.current.outputNames[0]];
            console.log("[Classifier] Output shape:", output.dims, "| Output name:", sessionRef.current.outputNames[0]);

            const results = decodeClassification(output, labels, options.topK ?? 1);
            console.log("[Classifier] Decoded", results.length, "results. Top result:", results[0]);
            return results;
        },
        [inputSize, labels, options.topK]
    );

    return { ready, error, runClassifier };
}

function imageDataToTensor(
    image: ImageData,
    inputSize: number,
    TensorCtor: typeof ort.Tensor
): ort.Tensor {
    const { data, width, height } = image;
    // TensorFlow models expect channels-last format: [batch, height, width, channels]
    const floatData = new Float32Array(inputSize * inputSize * 3);

    for (let y = 0; y < inputSize; y++) {
        for (let x = 0; x < inputSize; x++) {
            const idx = (y * width + x) * 4;
            const r = data[idx] / 255.0;
            const g = data[idx + 1] / 255.0;
            const b = data[idx + 2] / 255.0;

            // Channels-last: [H, W, C]
            const dst = (y * inputSize + x) * 3;
            floatData[dst] = r;
            floatData[dst + 1] = g;
            floatData[dst + 2] = b;
        }
    }
    // Shape: [batch, height, width, channels]
    return new TensorCtor("float32", floatData, [1, inputSize, inputSize, 3]);
}

function decodeClassification(
    output: ort.Tensor,
    labels: string[],
    topK: number
): ClassificationResult[] {
    const data = output.data as Float32Array;
    const probs = Array.from(data).map((score, index) => ({ score, index }));
    probs.sort((a, b) => b.score - a.score);

    const results: ClassificationResult[] = [];
    for (let i = 0; i < topK && i < probs.length; i++) {
        const { score, index } = probs[i];
        results.push({
            label: labels[index] || `class_${index}`,
            score: score,
            classId: index
        });
    }
    return results;
}
