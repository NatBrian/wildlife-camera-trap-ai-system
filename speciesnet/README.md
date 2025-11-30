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

## Integration with Web App

To use this model in the web application (using `onnxruntime-web`):

1.  **Move Files:**
    Copy `speciesnet.onnx` and `speciesnet_labels.json` to your web application's public assets folder (e.g., `web/public/models/`).

2.  **Model Input Specifications:**
    *   **Input Name:** `input` (or check model metadata)
    *   **Input Shape:** `(1, 480, 480, 3)` (Batch, Height, Width, Channels)
    *   **Pixel Values:** The model expects images with pixel values in the range `[0, 255]`. The EfficientNetV2 architecture typically includes internal preprocessing layers (rescaling/normalization), so you can pass standard RGB image data.
    *   **Format:** Channels Last (NHWC), which matches the standard HTML Canvas/ImageData format.

3.  **Inference Logic:**
    *   **Detection First:** Use a detector (like YOLO) to find the animal.
    *   **Crop:** Crop the image to the detected bounding box.
    *   **Resize:** Resize the crop to **480x480** pixels.
    *   **Classify:** Pass the resized crop to SpeciesNet.
    *   **Map Output:** The output is a probability vector. Map the index of the highest value to the name in `speciesnet_labels.json`.

## Files
*   `convert_speciesnet_keras.py`: Script to download and convert the model.
*   `generate_labels.py`: Script to parse and generate the labels JSON.
*   `requirements.txt`: Python dependencies.
