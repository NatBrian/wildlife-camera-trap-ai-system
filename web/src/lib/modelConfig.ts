export const DEFAULT_MODEL_CONFIG = {
  name: "megadetector_v5a", // "ena24"
  modelUrl: "/models/speciesnet_quant.onnx", // "/models/MDV6-yolov10-c.onnx", // "/models/my-ena24.onnx",
  labelsUrl: "/models/speciesnet_labels.json", // "/models/labels.json", // "/models/labels_ena24.json",
  inputSize: 640,
  confThreshold: 0.20,
  iouThreshold: 0.45,
  processEveryN: 2,
  silenceTimeoutMs: 4000,
};

export const DEFAULT_DEVICE_ID = process.env.NEXT_PUBLIC_DEVICE_ID || "browser-device";
