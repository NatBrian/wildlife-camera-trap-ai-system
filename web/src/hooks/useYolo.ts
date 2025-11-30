"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as ort from "onnxruntime-web";
import { Detection } from "@/types";

type Options = {
  modelUrl: string;
  labelsUrl?: string;
  inputSize?: number;
  confThreshold?: number;
  iouThreshold?: number;
  topk?: number;
  preferBackend?: "webgpu" | "wasm";
  useWorker?: boolean; // New flag to toggle worker usage
};

type UseYoloResult = {
  ready: boolean;
  error: string | null;
  labels: string[];
  inputSize: number;
  runInference: (image: ImageData) => Promise<Detection[]>;
};

const DEFAULT_IOU = 0.45;
const DEFAULT_CONF = 0.25;
const DEFAULT_TOPK = 50;

// --- Main Thread Helper Functions (Duplicated from worker for now) ---
function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

function xywhToXyxy(x: number, y: number, w: number, h: number) {
  const x1 = x - w / 2;
  const y1 = y - h / 2;
  const x2 = x + w / 2;
  const y2 = y + h / 2;
  return [x1, y1, x2, y2];
}

function iou(a: number[], b: number[]) {
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

function nonMaxSuppression(detections: Detection[], iouThreshold: number) {
  const sorted = [...detections].sort((a, b) => b.score - a.score);
  const results: Detection[] = [];

  while (sorted.length) {
    const current = sorted.shift()!;
    results.push(current);
    const remaining: Detection[] = [];
    for (const det of sorted) {
      if (iou(current.box, det.box) < iouThreshold) {
        remaining.push(det);
      }
    }
    sorted.splice(0, sorted.length, ...remaining);
  }

  return results;
}

function decodeDetections(
  output: any,
  labels: string[],
  confThreshold: number,
  iouThreshold: number,
  topk: number,
  inputSize: number
): Detection[] {
  const dims = output.dims;
  const data = output.data;

  if (!dims.length) return [];

  let anchors = 0;
  let values = 0;
  let channelsFirst = false;

  // Handle YOLOv10 format: [1, 300, 6] -> [x1, y1, x2, y2, score, class]
  if (dims.length === 3 && dims[2] === 6) {
    const numDetections = dims[1];
    const detections: Detection[] = [];
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
  const detections: Detection[] = [];

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

let tensorBuffer: Float32Array | null = null;

function imageDataToTensor(data: Uint8ClampedArray, width: number, height: number, inputSize: number) {
  const totalPixels = inputSize * inputSize;
  const tensorSize = 3 * totalPixels;

  if (!tensorBuffer || tensorBuffer.length !== tensorSize) {
    tensorBuffer = new Float32Array(tensorSize);
  }
  const floatData = tensorBuffer;

  if (width === inputSize && height === inputSize) {
    for (let i = 0; i < totalPixels; i++) {
      const base = i * 4;
      const r = data[base] / 255;
      const g = data[base + 1] / 255;
      const b = data[base + 2] / 255;
      floatData[i] = r;
      floatData[totalPixels + i] = g;
      floatData[2 * totalPixels + i] = b;
    }
  } else {
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

/**
 * Flexible YOLOv8 hook: Supports both Web Worker (default) and Main Thread execution.
 */
export function useYolo(options: Options): UseYoloResult {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState<string[]>([]);

  // Worker State
  const workerRef = useRef<Worker | null>(null);
  const pendingRequests = useRef<Map<string, { resolve: (d: Detection[]) => void; reject: (e: Error) => void }>>(new Map());

  // Main Thread State
  const sessionRef = useRef<ort.InferenceSession | null>(null);

  const inputSize = options.inputSize ?? 640;
  const useWorker = options.useWorker ?? true;

  useEffect(() => {
    setReady(false);
    setError(null);
    const abortController = new AbortController();

    const load = async () => {
      try {
        // Load Labels
        if (options.labelsUrl) {
          const res = await fetch(options.labelsUrl, { signal: abortController.signal });
          if (res.ok) {
            const loadedLabels = await res.json();
            setLabels(loadedLabels);
          }
        }

        if (useWorker) {
          // --- WORKER MODE ---
          const worker = new Worker("/yolo.worker.js");
          workerRef.current = worker;

          worker.onmessage = (e) => {
            const { type, payload, id } = e.data;
            if (type === "ready") {
              setReady(true);
              if (payload.labels && payload.labels.length) setLabels(payload.labels);
            } else if (type === "error") {
              if (id && pendingRequests.current.has(id)) {
                pendingRequests.current.get(id)?.reject(new Error(payload));
                pendingRequests.current.delete(id);
              } else {
                setError(payload);
              }
            } else if (type === "result") {
              if (id && pendingRequests.current.has(id)) {
                pendingRequests.current.get(id)?.resolve(payload);
                pendingRequests.current.delete(id);
              }
            }
          };

          worker.onerror = (err) => {
            console.error("Worker error:", err);
            setError("Worker error occurred");
          };

          worker.postMessage({
            type: "load",
            payload: {
              modelUrl: options.modelUrl,
              labelsUrl: options.labelsUrl,
              preferBackend: options.preferBackend,
              config: {
                inputSize: options.inputSize,
                confThreshold: options.confThreshold ?? DEFAULT_CONF,
                iouThreshold: options.iouThreshold ?? DEFAULT_IOU,
                topk: options.topk ?? DEFAULT_TOPK,
              },
            },
          });

        } else {
          // --- MAIN THREAD MODE ---
          ort.env.wasm.wasmPaths = "/onnxruntime/";
          ort.env.wasm.numThreads = 1;

          const executionProviders = ["wasm"];
          if (options.preferBackend === "webgpu" && typeof navigator !== "undefined" && (navigator as any).gpu) {
            executionProviders.unshift("webgpu");
          }

          const session = await ort.InferenceSession.create(options.modelUrl, {
            executionProviders,
          });
          sessionRef.current = session;
          setReady(true);
        }

      } catch (err) {
        if (!abortController.signal.aborted) {
          console.error("Failed to load model:", err);
          setError((err as Error).message);
        }
      }
    };

    load();

    return () => {
      abortController.abort();
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      sessionRef.current = null;
      pendingRequests.current.clear();
    };
  }, [options.modelUrl, options.labelsUrl, options.preferBackend, options.inputSize, options.confThreshold, options.iouThreshold, options.topk, useWorker]);

  const runInference = useCallback(
    async (image: ImageData): Promise<Detection[]> => {
      if (!ready) throw new Error("Model is not ready");

      if (useWorker) {
        // --- WORKER INFERENCE ---
        if (!workerRef.current) throw new Error("Worker not initialized");
        const id = Math.random().toString(36).substring(7);
        return new Promise<Detection[]>((resolve, reject) => {
          pendingRequests.current.set(id, { resolve, reject });
          const data = image.data;
          workerRef.current?.postMessage(
            {
              type: "detect",
              payload: {
                data: data,
                width: image.width,
                height: image.height,
              },
              id,
            },
            [data.buffer]
          );
        });

      } else {
        // --- MAIN THREAD INFERENCE ---
        if (!sessionRef.current) throw new Error("Session not initialized");

        try {
          const tensor = imageDataToTensor(image.data, image.width, image.height, inputSize);
          const inputName = sessionRef.current.inputNames[0];
          const outputNames = sessionRef.current.outputNames;

          const outputs = await sessionRef.current.run({ [inputName]: tensor });
          const firstOutput = outputs[outputNames[0]];

          return decodeDetections(
            firstOutput,
            labels,
            options.confThreshold ?? DEFAULT_CONF,
            options.iouThreshold ?? DEFAULT_IOU,
            options.topk ?? DEFAULT_TOPK,
            inputSize
          );
        } catch (e) {
          console.error("Inference failed:", e);
          throw e;
        }
      }
    },
    [ready, useWorker, inputSize, labels, options.confThreshold, options.iouThreshold, options.topk]
  );

  return { ready, error, labels, inputSize, runInference };
}
