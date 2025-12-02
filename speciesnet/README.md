# SpeciesNet ONNX Conversion Tools

This directory contains tools to download the **Google SpeciesNet** model and convert it to ONNX format for use in web applications.

## Attribution
**Model:** Google SpeciesNet  
**Source:** [Kaggle Models - Google SpeciesNet](https://www.kaggle.com/models/google/speciesnet)  
**License:** Please refer to the Kaggle model page for license terms.

## Setup

1.  **Install Dependencies:**
    It is recommended to use a virtual environment (like `.conda` or `venv`).
    ```bash
    pip install -r requirements.txt
    ```

## Usage

### 1. Convert Model to ONNX
Run the conversion script to download the latest Keras version of SpeciesNet and convert it to `speciesnet.onnx`.

```bash
python convert_speciesnet_keras.py
```
*   **Output:** `speciesnet.onnx`
*   **Note:** This script automatically handles the conversion from Keras HDF5 format to ONNX, including necessary renames for compatibility with newer Keras versions.

### 2. Generate Labels (SpeciesNet Specific)
Run the labels generation script to extract the class names from the **downloaded SpeciesNet metadata file** (`.labels.txt`). This is required because the SpeciesNet ONNX model does *not* contain embedded labels.

```bash
python generate_labels.py
```
*   **Output:** `speciesnet_labels.json`

### 3. Inspect ONNX Labels (General Tool)
Use this general-purpose tool to inspect **any** ONNX model (like YOLO exports) to see if it contains embedded labels in its metadata and extract them.

```bash
python inspect_onnx_labels.py path/to/model.onnx --output labels.json
```
*   **Arguments:**
    *   `model_path`: Path to the .onnx file.
    *   `--output` (optional): Path to save the extracted labels as a JSON array.

### 4. Quantize Model
Reduce the model size (approx. 75% reduction) by quantizing it to INT8. This is recommended for web deployment to reduce download time and bypass file size limits (e.g., GitHub's 100MB limit).

```bash
python quantize_model.py
```
*   **Input:** `web/public/models/speciesnet.onnx` (or `speciesnet.onnx` in current dir)
*   **Output:** `web/public/models/speciesnet_quant.onnx`

## Web App Integration

To use SpeciesNet in the web application, we implement a **Two-Stage Pipeline**:

1.  **Detection (Stage 1):** Use a general purpose detector (MegaDetector v6 YOLOv10) to find animals and generate bounding boxes.
2.  **Classification (Stage 2):** Crop the detected animal regions and pass them to SpeciesNet to identify the specific species.

### Configuration

Update your `web/src/lib/modelConfig.ts` to include the classifier configuration:

```typescript
export const DEFAULT_MODEL_CONFIG = {
  // Stage 1: Detector (MegaDetector v6)
  name: "megadetector_v5a",
  modelUrl: "/models/MDV6-yolov10-c.onnx",
  labelsUrl: "/models/labels.json",
  inputSize: 640,
  confThreshold: 0.20,
  iouThreshold: 0.45,
  processEveryN: 3,
  silenceTimeoutMs: 4000,
  
  // Stage 2: Classifier (SpeciesNet)
  classifier: {
    modelUrl: "/models/speciesnet_quant.onnx",
    labelsUrl: "/models/speciesnet_labels.json",
    inputSize: 480, // Use 480 for accuracy (model supports 224, 384, or 480)
    topK: 1,
  },
};
```

### Web Worker Architecture

The web app uses dedicated Web Workers for AI inference:

- **`web/public/yolo.worker.js`**: Handles MegaDetector inference
  - Loads ONNX Runtime from `/onnxruntime/ort.all.min.js`
  - Supports both channels-first (NCHW) tensor layout for YOLO models
  - Used for both live detection (main thread) and post-processing (worker)

- **`web/public/classifier.worker.js`**: Handles SpeciesNet inference
  - Loads ONNX Runtime from `/onnxruntime/ort.all.min.js`
  - Uses channels-last (NHWC) tensor layout for SpeciesNet
  - Runs only during post-processing (optional, configurable in UI)
  - Returns top-5 classification results with confidence scores

Both workers load ONNX Runtime WASM files from `/onnxruntime/` (local files copied during `npm install` via `postinstall` script).

### Inference Logic

The `CameraCapture` component orchestrates the two-stage pipeline:

1.  **Live Detection (Main Thread):**
    - Runs MegaDetector on every Nth frame (configurable via `processEveryN`).
    - Draws bounding boxes on the live canvas for real-time feedback.
    - Captures keyframes (ImageData + detections) when animals are detected.

2.  **Auto-Recording:**
    - Starts recording when an animal is first detected.
    - Continues recording as long as animals are present.
    - Stops recording after `silenceTimeoutMs` milliseconds of no detections.
    - All captured keyframes are stored during recording.

3.  **Post-Processing Classification (Optional, Web Worker):**
    - Triggered after recording stops (if classifier is enabled in UI).
    - Processes captured keyframes using `classifyCapturedFrames()`:
      - For each keyframe with animal detections:
        - Crops each detected animal bounding box.
        - Resizes crop to classifier input size (480x480).
        - Runs SpeciesNet classifier via `useClassifier` hook.
      - Uses top-5 results with blank filtering:
        - Skips "blank" labels if a valid species is found in top-5 with score > 0.1.
        - Falls back to generic "animal" label if no specific species identified.
    - Returns species counts for the entire clip.

4.  **Upload:**
    - Video blob, thumbnail, metadata, and species counts uploaded to Supabase via `uploadClipToSupabase()`.

### Key Implementation Details

- **Tensor Layouts:**
  - YOLO (MegaDetector): NCHW layout `[1, 3, 640, 640]` (channels-first)
  - SpeciesNet: NHWC layout `[1, 480, 480, 3]` (channels-last)
  
- **Normalization:**
  - Both models expect pixel values normalized to 0.0-1.0 range (divide by 255).

- **Keyframe Capture:**
  - Instead of seeking through the recorded video, keyframes are captured during live detection.
  - This eliminates video decoding latency and ensures consistent frame quality.

- **Classification Strategy:**
  - Classifier is optional and disabled by default in the UI.
  - Top-5 results analyzed to filter out "blank" predictions.
  - Score threshold of 0.1 for species (lower than detection threshold due to classifier uncertainty).
  - Falls back to generic YOLO label ("animal") if classifier unable to identify species.

## Files
*   `convert_speciesnet_keras.py`: Script to download and convert the model.
*   `generate_labels.py`: Script to parse and generate the labels JSON.
*   `inspect_onnx_labels.py`: General tool to inspect ONNX model labels.
*   `quantize_model.py`: Script to quantize model to INT8 for reduced size.
*   `requirements.txt`: Python dependencies.
