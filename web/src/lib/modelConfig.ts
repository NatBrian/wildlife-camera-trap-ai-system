export const DEFAULT_MODEL_CONFIG = {
  name: "yolov8n",
  modelUrl: "/models/best.onnx",
  labelsUrl: "/models/labels.json",
  inputSize: 640,
  confThreshold: 0.50,
  iouThreshold: 0.45,
  processEveryN: 2,
  silenceTimeoutMs: 4000,
};

export const DEFAULT_DEVICE_ID = process.env.NEXT_PUBLIC_DEVICE_ID || "browser-device";
