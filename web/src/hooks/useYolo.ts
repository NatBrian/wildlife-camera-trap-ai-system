"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type * as ort from "onnxruntime-web";

import { Detection } from "@/types";

type Options = {
  modelUrl: string;
  labelsUrl?: string;
  inputSize?: number;
  confThreshold?: number;
  iouThreshold?: number;
  topk?: number;
  preferBackend?: "webgpu" | "wasm";
};

type UseYoloResult = {
  ready: boolean;
  error: string | null;
  labels: string[];
  inputSize: number;
  runInference: (image: ImageData) => Promise<Detection[]>;
};

const DEFAULT_IOU = 0.45;
const DEFAULT_CONF = 0.35;
const DEFAULT_TOPK = 50;

/**
 * Lightweight YOLOv8 ONNX runtime hook for the browser.
 * Expects an ONNX export with layout matching ultralytics defaults.
 */
export function useYolo(options: Options): UseYoloResult {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const sessionRef = useRef<ort.InferenceSession | null>(null);
  const ortRef = useRef<typeof import("onnxruntime-web")>();
  const inputNameRef = useRef<string>("images");
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const inputSize = options.inputSize ?? 640;

  useEffect(() => {
    let canceled = false;
    setReady(false);
    setError(null);

    async function load() {
      try {
        const ort = await import("onnxruntime-web");
        ortRef.current = ort;
        // Prefer WebGPU if available, otherwise fall back to WASM.
        const executionProviders: ort.InferenceSession.SessionOptions["executionProviders"] = [];
        if (options.preferBackend === "webgpu" && typeof navigator !== "undefined" && "gpu" in navigator) {
          executionProviders.push("webgpu");
        }
        executionProviders.push("wasm");
        // Allow fetching wasm binaries from CDN if not bundled.
        if (ort.env.wasm && !ort.env.wasm.wasmPaths) {
          ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";
        }

        const session = await ort.InferenceSession.create(options.modelUrl, {
          executionProviders,
        });

        if (canceled) return;
        sessionRef.current = session;
        inputNameRef.current = session.inputNames[0];
        setReady(true);
      } catch (err) {
        if (canceled) return;
        setError((err as Error)?.message || "Failed to load model");
      }
    }

    async function loadLabels() {
      if (!options.labelsUrl) return;
      try {
        const res = await fetch(options.labelsUrl);
        if (!res.ok) throw new Error(`Failed to fetch labels: ${res.statusText}`);
        const data = (await res.json()) as string[];
        if (!canceled) setLabels(data);
      } catch (err) {
        if (!canceled) setError((err as Error)?.message || "Failed to load labels");
      }
    }

    load();
    loadLabels();

    return () => {
      canceled = true;
    };
  }, [options.modelUrl, options.labelsUrl, options.preferBackend]);

  const runInference = useCallback(
    async (image: ImageData): Promise<Detection[]> => {
      if (!sessionRef.current || !ortRef.current) throw new Error("Model is not ready");

      const conf = optionsRef.current.confThreshold ?? DEFAULT_CONF;
      const iou = optionsRef.current.iouThreshold ?? DEFAULT_IOU;
      const topk = optionsRef.current.topk ?? DEFAULT_TOPK;

      const tensor = imageDataToTensor(image, inputSize, ortRef.current.Tensor);
      const outputs = await sessionRef.current.run({ [inputNameRef.current]: tensor });
      const firstOutput = outputs[sessionRef.current.outputNames[0]];
      if (!firstOutput) throw new Error("No output from model");
      const detections = decodeDetections(firstOutput, labels, conf, iou, topk, inputSize);
      return detections;
    },
    [inputSize, labels],
  );

  return { ready, error, labels, inputSize, runInference };
}

function imageDataToTensor(
  image: ImageData,
  inputSize: number,
  TensorCtor: typeof ort.Tensor,
): ort.Tensor {
  const { data, width, height } = image;
  const floatData = new Float32Array(3 * inputSize * inputSize);
  // Assume incoming image is already resized to inputSize x inputSize.
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
  return new TensorCtor("float32", floatData, [1, 3, inputSize, inputSize]);
}

function decodeDetections(
  output: ort.Tensor,
  labels: string[],
  confThreshold: number,
  iouThreshold: number,
  topk: number,
  inputSize: number,
): Detection[] {
  const dims = output.dims;
  const data = output.data as Float32Array;

  if (!dims.length) return [];

  let anchors = 0;
  let values = 0;
  let channelsFirst = false;

  // Handle both (1, channels, anchors) and (1, anchors, values) layouts.
  if (dims.length === 3) {
    if (dims[1] > dims[2]) {
      // [1, anchors, values] - e.g. [1, 8400, 84]
      anchors = dims[1];
      values = dims[2];
      channelsFirst = false;
    } else {
      // [1, values, anchors] - e.g. [1, 84, 8400]
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

function xywhToXyxy(x: number, y: number, w: number, h: number): [number, number, number, number] {
  const x1 = x - w / 2;
  const y1 = y - h / 2;
  const x2 = x + w / 2;
  const y2 = y + h / 2;
  return [x1, y1, x2, y2];
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function nonMaxSuppression(detections: Detection[], iouThreshold: number): Detection[] {
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

function iou(a: [number, number, number, number], b: [number, number, number, number]): number {
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
