# Wildlife Camera-Trap AI System

An end-to-end AI system for detecting and recording wildlife. Supports training custom models, running inference on edge devices (Python) or directly in the browser (Web), and managing clips via a modern dashboard.

![demo](web/public/demo.gif)

## Project Structure

```
.
├── infra/
│   ├── supabase_schema.sql        # Database schema (clips table + indexes + RLS)
│   └── .env.example               # Supabase keys template
├── notebook/                      # Model Training
│   └── wildlife_yolov8_pipeline.ipynb # End-to-end YOLOv8 training & export pipeline
├── speciesnet/                    # SpeciesNet Conversion Tools
│   ├── convert_speciesnet_keras.py # Download & convert SpeciesNet to ONNX
│   ├── generate_labels.py         # Extract species labels from model metadata
│   ├── inspect_onnx_labels.py     # General ONNX label inspection tool
│   └── quantize_model.py          # INT8 quantization for reduced model size
├── edge/                          # Python Capture App (Dedicated Hardware)
│   ├── config.yaml                # Capture settings (camera, model, thresholds)
│   ├── main.py                    # Orchestrates capture loop
│   ├── detection.py               # YOLOv8 (PyTorch) wrapper
│   ├── recorder.py                # Video recording & file management
│   ├── supabase_client.py         # Uploads metadata & thumbnails
└── web/                           # Next.js Web App (Dashboard + Browser Capture)
    ├── public/
    │   ├── models/                # ONNX models & labels
    │   ├── classifier.worker.js   # SpeciesNet inference worker
    │   ├── yolo.worker.js         # YOLO detection worker
    ├── src/app/
    │   ├── page.tsx               # Dashboard (Clip List)
    │   └── capture/page.tsx       # In-Browser Capture Page
    ├── src/components/
    │   └── CameraCapture.tsx      # Main capture component
    ├── src/hooks/
    │   ├── useYolo.ts             # YOLO detection hook (hybrid worker/main-thread)
    │   └── useClassifier.ts       # SpeciesNet classification hook
    └── src/lib/
        ├── modelConfig.ts         # Model configuration (detector + classifier)
        ├── processRecordedClip.ts # Post-recording classification logic
        └── uploadClip.ts          # Supabase upload utilities
```

## 1. Notebook (Training & Export)

Located in `notebook/wildlife_yolov8_pipeline.ipynb`.
- **Purpose**: Train YOLOv8 models on wildlife datasets (e.g., ENA24, LILA BC).
- **Features**:
  - Dataset download and formatting.
  - Model training (YOLOv8n/s/m).
  - Evaluation and visualization.
  - **Export to ONNX**: Converts trained models to `.onnx` format for use in the Web App.

## 2. Web App (Dashboard + Browser Capture)

A Next.js application with advanced AI-powered wildlife detection and classification.

### Features
- **Dashboard**: Browse, filter, and watch recorded clips stored in Supabase.
- **In-Browser Capture** (`/capture`): 
  - Turns any laptop or phone into a camera trap.
  - **Two-Stage AI Pipeline**:
    - **Stage 1 (Detection)**: Runs via ONNX Runtime Web to detect animals in real-time.
    - **Stage 2 (Classification)**: Classifier identifies specific species from detected animals (optional, configurable via UI).
  - **Hybrid Architecture**: 
    - Main-thread YOLO inference for low-latency live view (smooth bounding boxes).
    - Web Worker-based YOLO and SpeciesNet for background post-recording processing (no UI freezing).
  - **Efficient Keyframe Capture**: Captures high-quality frames during live detection, eliminating video seeking during post-processing.
  - **CDN Powered**: ONNX Runtime loaded via local files with CDN fallback for reliability.
  - Auto-records clips when animals are detected and uploads to Supabase.
  - Configurable models in `public/models` (custom ENA24).

### AI Pipeline Details
1. **Live Detection**: Runs on every Nth frame (configurable) to detect animals.
2. **Auto-Recording**: When an animal is detected, recording automatically starts and captures keyframes.
3. **Post-Processing Classification** (Optional):
   - Extracts captured keyframes with animal detections.
   - Crops each detected animal bounding box.
   - Runs SpeciesNet classifier on each crop to identify species.
   - Combines results into species counts for the entire clip.
4. **Upload**: Metadata, thumbnails, and species counts uploaded to Supabase.

### Setup
1. `cd web`
2. `cp .env.example .env.local` and fill in Supabase credentials.
3. `npm install`
4. `npm run dev` → Open `http://localhost:3000`

## 3. Edge App (Python Capture)

A lightweight Python application designed for dedicated edge devices (Raspberry Pi, Jetson, Laptop).

### Features
- Runs **YOLOv8 (PyTorch)** for high-performance inference.
- Connects to USB webcams or RTSP streams.
- Records `.mp4` clips locally and syncs metadata/thumbnails to Supabase.
- Supports offline operation (uploads when internet is available).
- Notifications via Telegram or Discord.

### Setup
1. `cd edge`
2. `cp config.example.yaml config.yaml` (Edit settings: camera source, model path, etc.)
3. `cp .env.example .env` (Add Supabase & Notification keys)
4. `pip install -r requirements.txt`
5. `python main.py --config config.yaml`

## Supabase Setup (Backend)

1. Create a Supabase project.
2. Run `infra/supabase_schema.sql` in the SQL Editor to create the `clips` table and policies.
3. Create a public storage bucket named `thumbnails`.
4. Get your URL and Keys (Anon Key for Web, Service Role Key for Edge/Admin).

## Quick Start

**To run the Web Dashboard & Browser Capture:**
```bash
cd web
npm install
npm run dev
# Visit http://localhost:3000/capture to try the camera
```

**To run the Python Edge Capture:**
```bash
cd edge
pip install -r requirements.txt
python main.py --config config.yaml
```
