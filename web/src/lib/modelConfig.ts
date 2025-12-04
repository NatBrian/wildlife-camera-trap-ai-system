export const DEFAULT_MODEL_CONFIG = {
  name: "megadetector_v5a",
  modelUrl: "/models/my-MDV6-yolov10-c-hybrid-7class.onnx",
  labelsUrl: "/models/labels_my-MDV6-yolov10-c-hybrid-7class.json",
  inputSize: 640,
  confThreshold: 0.20,
  iouThreshold: 0.45,
  processEveryN: 3,
  silenceTimeoutMs: 4000,
  classifier: {
    modelUrl: "/models/speciesnet_quant.onnx",
    labelsUrl: "/models/speciesnet_labels.json",
    inputSize: 480,
    topK: 1,
  },
};

export const DEFAULT_DEVICE_ID = process.env.NEXT_PUBLIC_DEVICE_ID || "browser-device";
