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

1.  **Detection (Stage 1):** Use a general purpose detector (MegaDetector v5 / YOLOv10) to find animals and generate bounding boxes.
2.  **Classification (Stage 2):** Crop the detected animal regions and pass them to SpeciesNet to identify the specific species.

### Configuration

Update your `web/src/lib/modelConfig.ts` to include the classifier configuration:

```typescript
export const DEFAULT_MODEL_CONFIG = {
  // Stage 1: Detector (MegaDetector)
  name: "megadetector_v5a",
  modelUrl: "/models/MDV6-yolov10-c.onnx",
  labelsUrl: "/models/labels.json",
  inputSize: 640,
  confThreshold: 0.20,
  
  // Stage 2: Classifier (SpeciesNet)
  classifier: {
    modelUrl: "/models/speciesnet_quant.onnx",
    labelsUrl: "/models/speciesnet_labels.json",
    inputSize: 224, // Use 224 for speed, or 480 for max accuracy
    topK: 1,
  },
  // ...
};
```

### Inference Logic

The `CameraCapture` component handles the pipeline:
1.  **Detect:** Run YOLO inference on the full frame.
2.  **Filter:** Select detections labeled "animal".
3.  **Crop & Resize:** Crop the animal from the video feed and resize to the classifier's input size (e.g., 224x224).
4.  **Classify:** Run SpeciesNet inference on the crop.
5.  **Update:** Replace the generic "animal" label with the specific species name (e.g., "African Elephant").

## Files
*   `convert_speciesnet_keras.py`: Script to download and convert the model.
*   `generate_labels.py`: Script to parse and generate the labels JSON.
*   `requirements.txt`: Python dependencies.
