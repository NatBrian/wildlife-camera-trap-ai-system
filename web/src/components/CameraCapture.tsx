"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { useYolo } from "@/hooks/useYolo";
import { useClassifier } from "@/hooks/useClassifier";
import { DEFAULT_DEVICE_ID, DEFAULT_MODEL_CONFIG } from "@/lib/modelConfig";
import { uploadClipToSupabase } from "@/lib/uploadClip";
import { classifyCapturedFrames } from "@/lib/processRecordedClip";
import { Detection, SpeciesCounts } from "@/types";

type RecordedClip = {
  id: string; // Unique ID
  blob: Blob;
  url: string;
  thumbnail?: Blob | null;
  startedAt: Date;
  endedAt: Date;
  speciesCounts: SpeciesCounts;
  framesWithAnimals: number;
  classificationComplete?: boolean;
  classificationError?: string | null;
  classificationProgress?: string;
  uploadStatus: "idle" | "uploading" | "success" | "error";
  uploadError?: string;
  videoUrl?: string;
};

type UploadState = "idle" | "uploading" | "success" | "error";

const SUPPORTED = typeof window !== "undefined" && typeof navigator !== "undefined";

export default function CameraCapture() {
  const [isMounted, setIsMounted] = useState(false);
  const [deviceId, setDeviceId] = useState(DEFAULT_DEVICE_ID);
  const [autoRecord, setAutoRecord] = useState(false);
  const [autoUpload, setAutoUpload] = useState(false);
  const [enableClassifier, setEnableClassifier] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [liveCounts, setLiveCounts] = useState<SpeciesCounts>({});
  const [maxCounts, setMaxCounts] = useState<SpeciesCounts>({});
  const [status, setStatus] = useState<string | null>(null);
  const [captures, setCaptures] = useState<RecordedClip[]>([]);
  const [fps, setFps] = useState<number>(0);

  // Helper to update a specific clip by ID
  const updateCapture = useCallback((id: string, updates: Partial<RecordedClip>) => {
    setCaptures(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  }, []);

  // Settings
  const [maxFileSizeMB, setMaxFileSizeMB] = useState(45);
  const [resolutionHeight, setResolutionHeight] = useState(360);
  const [targetFps, setTargetFps] = useState(15);
  const [bitrate, setBitrate] = useState(500000); // 0.5 Mbps
  const [currentSizeMB, setCurrentSizeMB] = useState(0);
  const [showSettings, setShowSettings] = useState(false);

  const detectionTimestampsRef = useRef<number[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const inferenceCanvasRef = useRef<HTMLCanvasElement>(null);
  const classifierCanvasRef = useRef<HTMLCanvasElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingRef = useRef(false);
  const framesWithAnimalsRef = useRef(0);
  const maxSpeciesCountsRef = useRef<SpeciesCounts>({});
  const startTimeRef = useRef<Date | null>(null);
  const detectionsRef = useRef<Detection[]>([]);
  const rafRef = useRef<number | null>(null);
  const frameCounterRef = useRef(0);
  const isProcessingRef = useRef(false);
  const loopStartedRef = useRef(false);
  const lastFrameTimeRef = useRef<number | null>(null);
  const lastDetectionTimeRef = useRef<number | null>(null);
  const loopRef = useRef<() => void>();
  const bestThumbnailRef = useRef<Blob | null>(null);
  const lastFpsUpdateRef = useRef<number>(0);
  const lastSizeUpdateRef = useRef<number>(0);
  const lastEmittedCountsRef = useRef<string>("");
  const keyFramesRef = useRef<{ imageData: ImageData; detections: Detection[] }[]>([]);
  const lastKeyFrameTimeRef = useRef<number>(0);

  const processEveryN = DEFAULT_MODEL_CONFIG.processEveryN ?? 2;
  const silenceTimeoutMs = DEFAULT_MODEL_CONFIG.silenceTimeoutMs ?? 4000;

  // 1. Live Camera Model (Main Thread for speed)
  const { ready: modelReady, error: modelError, inputSize, runInference: runLiveInference } = useYolo({
    modelUrl: DEFAULT_MODEL_CONFIG.modelUrl,
    labelsUrl: DEFAULT_MODEL_CONFIG.labelsUrl,
    inputSize: DEFAULT_MODEL_CONFIG.inputSize,
    confThreshold: DEFAULT_MODEL_CONFIG.confThreshold,
    iouThreshold: DEFAULT_MODEL_CONFIG.iouThreshold,
    preferBackend: "webgpu",
    useWorker: false, // Run on main thread for live view
  });



  const { ready: classifierReady, runClassifier, error: classifierError } = useClassifier({
    modelUrl: DEFAULT_MODEL_CONFIG.classifier?.modelUrl || "",
    labelsUrl: DEFAULT_MODEL_CONFIG.classifier?.labelsUrl,
    inputSize: DEFAULT_MODEL_CONFIG.classifier?.inputSize,
    preferBackend: "webgpu",
    enabled: enableClassifier,
  });

  // Log classifier ready state on every render
  useEffect(() => {
    console.log("[CameraCapture] classifierReady changed to:", classifierReady);
  }, [classifierReady]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const resizeCanvases = useCallback(
    (videoWidth: number, videoHeight: number) => {
      const displayCanvas = displayCanvasRef.current;
      const inferenceCanvas = inferenceCanvasRef.current;
      if (displayCanvas) {
        displayCanvas.width = videoWidth;
        displayCanvas.height = videoHeight;
      }
      if (inferenceCanvas) {
        inferenceCanvas.width = inputSize;
        inferenceCanvas.height = inputSize;
      }
    },
    [inputSize],
  );

  const startCamera = useCallback(async () => {
    setStatus(null);
    if (!SUPPORTED) {
      setStatus("Camera is not available in this environment.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          height: { ideal: resolutionHeight },
        },
        audio: false,
      });
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      const width = videoRef.current.videoWidth || 1280;
      const height = videoRef.current.videoHeight || 720;
      resizeCanvases(width, height);
      setCameraReady(true);
    } catch (err) {
      setStatus((err as Error)?.message || "Unable to start camera");
    }
  }, [resizeCanvases, resolutionHeight]);

  const stopCamera = useCallback(() => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  const processUpload = useCallback(
    async (clip: RecordedClip) => {
      updateCapture(clip.id, { uploadStatus: "uploading", uploadError: undefined });
      // setStatus("Uploading clip..."); // Optional: Global status might be confusing with multiple uploads
      try {
        const result = await uploadClipToSupabase({
          videoBlob: clip.blob,
          thumbnailBlob: clip.thumbnail,
          startedAt: clip.startedAt,
          endedAt: clip.endedAt,
          deviceId,
          speciesCounts: clip.speciesCounts,
          framesWithAnimals: clip.framesWithAnimals,
        });
        updateCapture(clip.id, { uploadStatus: "success", videoUrl: result.videoUrl });
      } catch (err) {
        updateCapture(clip.id, { uploadStatus: "error", uploadError: (err as Error)?.message });
      }
    },
    [deviceId, updateCapture]
  );

  const startRecording = useCallback(() => {
    if (typeof MediaRecorder === "undefined") {
      setStatus("MediaRecorder is not supported in this browser.");
      return;
    }
    if (!displayCanvasRef.current || typeof displayCanvasRef.current.captureStream !== "function") {
      setStatus("Canvas captureStream is not supported.");
      return;
    }
    if (recordingRef.current) return;

    const stream = displayCanvasRef.current.captureStream(targetFps);
    const mimeType = pickMimeType();
    const options: MediaRecorderOptions = {
      mimeType,
      videoBitsPerSecond: bitrate,
    };

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, options);
    } catch (e) {
      console.warn("MediaRecorder failed with options, falling back to default", e);
      recorder = new MediaRecorder(stream);
    }

    chunksRef.current = [];
    maxSpeciesCountsRef.current = {};
    framesWithAnimalsRef.current = 0;
    detectionTimestampsRef.current = [];
    keyFramesRef.current = [];
    lastKeyFrameTimeRef.current = 0;
    startTimeRef.current = new Date();
    bestThumbnailRef.current = null; // Reset best thumbnail
    setCurrentSizeMB(0);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
      const url = URL.createObjectURL(blob);
      if (!displayCanvasRef.current) return;

      const thumb = bestThumbnailRef.current || await canvasToJpeg(displayCanvasRef.current);
      const id = Date.now().toString(); // Generate ID

      const clip: RecordedClip = {
        id,
        blob,
        url,
        thumbnail: thumb,
        startedAt: startTimeRef.current || new Date(),
        endedAt: new Date(),
        speciesCounts: { ...maxSpeciesCountsRef.current },
        framesWithAnimals: framesWithAnimalsRef.current,
        classificationComplete: false,
        classificationError: null,
        uploadStatus: "idle",
      };

      // Add to list immediately
      setCaptures((prev) => [clip, ...prev]);
      setMaxCounts({ ...maxSpeciesCountsRef.current });
      setStatus("Clip recorded. Processing in background...");

      // Start Async Classification
      if (classifierReady && enableClassifier) {
        console.log(`[Capture ${id}] Starting classification`);

        const runClassification = async () => {
          if (keyFramesRef.current.length > 0) {
            console.log(`[Capture ${id}] Using ${keyFramesRef.current.length} captured frames`);
            return classifyCapturedFrames(
              keyFramesRef.current,
              runClassifier,
              DEFAULT_MODEL_CONFIG.classifier?.inputSize || 480,
              (current, total) => {
                updateCapture(id, { classificationProgress: `(${current}/${total})` });
              }
            );
          } else {
            console.log(`[Capture ${id}] No captured frames to classify.`);
            return {};
          }
        };

        runClassification().then((classifiedCounts) => {
          console.log(`[Capture ${id}] Complete`);
          updateCapture(id, {
            speciesCounts: classifiedCounts,
            classificationComplete: true,
            classificationProgress: undefined
          });

          // Auto Upload (using the fresh counts)
          if (autoUpload) {
            processUpload({ ...clip, speciesCounts: classifiedCounts });
          }
        }).catch((err) => {
          console.error(`[Capture ${id}] Failed`, err);
          updateCapture(id, {
            classificationError: err.message,
            classificationComplete: true,
            classificationProgress: undefined
          });
        });
      } else {
        // No classifier, just mark complete
        // If disabled, we don't treat it as an error, just skipped
        const errorMsg = enableClassifier ? "Classifier not ready" : null;
        updateCapture(id, { classificationComplete: true, classificationError: errorMsg });
        if (autoUpload) processUpload(clip);
      }
    };

    recorder.start(1000); // Request data every second to update size estimate
    recorderRef.current = recorder;
    recordingRef.current = true;
    setRecording(true);
    setStatus("Recording...");
  }, [autoUpload, bitrate, classifierReady, inputSize, processUpload, runClassifier, runLiveInference, targetFps]);

  const stopRecording = useCallback(() => {
    if (!recordingRef.current || !recorderRef.current) return;
    recorderRef.current.stop();
    recordingRef.current = false;
    setRecording(false);
  }, []);

  const handleAutoRecording = useCallback(
    (hasDetections: boolean) => {
      const now = Date.now();
      if (hasDetections && !recordingRef.current) {
        startRecording();
      }
      if (
        !hasDetections &&
        recordingRef.current &&
        lastDetectionTimeRef.current &&
        now - lastDetectionTimeRef.current > silenceTimeoutMs
      ) {
        stopRecording();
      }
    },
    [silenceTimeoutMs, startRecording, stopRecording],
  );

  const loop = useCallback(() => {
    const video = videoRef.current;
    const displayCanvas = displayCanvasRef.current;
    const inferCanvas = inferenceCanvasRef.current;
    if (!video || !displayCanvas || !inferCanvas) return;

    const displayCtx = displayCanvas.getContext("2d");
    const inferCtx = inferCanvas.getContext("2d");
    if (!displayCtx || !inferCtx) return;

    if (video.videoWidth && video.videoHeight) {
      if (displayCanvas.width !== video.videoWidth || displayCanvas.height !== video.videoHeight) {
        resizeCanvases(video.videoWidth, video.videoHeight);
      }
      displayCtx.drawImage(video, 0, 0, displayCanvas.width, displayCanvas.height);
    }

    const now = performance.now();
    if (lastFrameTimeRef.current) {
      const delta = now - lastFrameTimeRef.current;
      if (delta > 0) {
        const currentFps = 1000 / delta;
        // Throttle FPS updates to avoid excessive re-renders (every ~500ms)
        if (!lastFpsUpdateRef.current || now - lastFpsUpdateRef.current > 500) {
          setFps(Math.round(currentFps));
          lastFpsUpdateRef.current = now;
        }
      }
    }
    lastFrameTimeRef.current = now;

    // File size monitoring
    if (recordingRef.current && startTimeRef.current) {
      // Throttle size updates (every ~1000ms)
      if (!lastSizeUpdateRef.current || now - lastSizeUpdateRef.current > 1000) {
        const currentBlobSize = chunksRef.current.reduce((acc, chunk) => acc + chunk.size, 0);
        const sizeMB = currentBlobSize / (1024 * 1024);
        setCurrentSizeMB(sizeMB);
        lastSizeUpdateRef.current = now;

        if (sizeMB >= maxFileSizeMB) {
          console.log("Max file size reached, stopping recording.");
          stopRecording();
        }
      }
    }

    frameCounterRef.current += 1;
    const shouldProcess = frameCounterRef.current % processEveryN === 0;

    // Run inference asynchronously without blocking the render loop
    const runInferenceEnabled = true;
    if (runInferenceEnabled && shouldProcess && modelReady && !isProcessingRef.current && video.videoWidth && video.videoHeight) {
      isProcessingRef.current = true;

      // Capture image data synchronously to ensure it matches current frame
      inferCtx.drawImage(video, 0, 0, inputSize, inputSize);
      const imageData = inferCtx.getImageData(0, 0, inputSize, inputSize);

      // Fire and forget inference
      runLiveInference(imageData)
        .then((allDetections) => {
          const detections = allDetections.filter(d => d.label !== "person" && d.label !== "vehicle");
          detectionsRef.current = detections;
          const counts = toCounts(detections);

          // Only update state if counts changed to avoid re-renders
          const countsStr = JSON.stringify(counts);
          if (countsStr !== lastEmittedCountsRef.current) {
            setLiveCounts(counts);
            lastEmittedCountsRef.current = countsStr;
          }

          if (detections.length) {
            lastDetectionTimeRef.current = Date.now();
            if (recordingRef.current) {
              framesWithAnimalsRef.current += 1;

              // Store timestamp relative to start time
              if (startTimeRef.current) {
                const timeSinceStart = Date.now() - startTimeRef.current.getTime();
                detectionTimestampsRef.current.push(timeSinceStart);
              }

              // Capture keyframe for post-processing (max 1 per second)
              if (now - lastKeyFrameTimeRef.current > 1000) {
                keyFramesRef.current.push({
                  imageData: imageData,
                  detections: detections
                });
                lastKeyFrameTimeRef.current = now;
              }

              bumpSpeciesMax(maxSpeciesCountsRef.current, counts);

              if (!bestThumbnailRef.current && displayCanvasRef.current) {
                canvasToJpeg(displayCanvasRef.current).then(blob => {
                  if (blob && recordingRef.current) bestThumbnailRef.current = blob;
                });
              }
            }
          }

          if (autoRecord) {
            handleAutoRecording(detections.length > 0);
          }
        })
        .catch((err) => {
          setStatus((err as Error)?.message || "Inference failed");
        })
        .finally(() => {
          isProcessingRef.current = false;
        });
    }

    if (displayCtx && detectionsRef.current.length) {
      drawDetections(displayCtx, detectionsRef.current, displayCanvas.width / inputSize, displayCanvas.height / inputSize);
    }

    rafRef.current = requestAnimationFrame(() => loopRef.current?.());
  }, [
    autoRecord,
    handleAutoRecording,
    inputSize,
    maxFileSizeMB,
    modelReady,
    processEveryN,
    resizeCanvases,
    runLiveInference,
    stopRecording,
  ]);

  // Update loopRef whenever loop changes
  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  useEffect(() => {
    return () => {
      stopRecording();
      stopCamera();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [stopCamera, stopRecording]);

  useEffect(() => {
    if (!cameraReady || !modelReady || loopStartedRef.current) return;
    loopStartedRef.current = true;
    // Start the loop via the ref
    rafRef.current = requestAnimationFrame(() => loopRef.current?.());
  }, [cameraReady, modelReady]); // Removed 'loop' from deps to prevent double-start logic issues

  const detectionSummary = useMemo(
    () =>
      Object.entries(liveCounts)
        .map(([species, count]) => `${species} x${count}`)
        .join(", "),
    [liveCounts],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Live capture</p>
          <h2 className="text-xl font-semibold text-mint">Run YOLO in-browser</h2>
        </div>
        <div className="flex gap-3 text-sm">
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className="px-4 py-2 rounded-lg border border-white/20 text-slate-200 hover:bg-white/5"
          >
            {showSettings ? "Hide Settings" : "Settings"}
          </button>
          <button
            type="button"
            onClick={startCamera}
            className="px-4 py-2 rounded-lg bg-mint text-night font-semibold shadow"
          >
            Start camera
          </button>
          <button
            type="button"
            onClick={stopCamera}
            className="px-4 py-2 rounded-lg border border-white/20 text-slate-200"
          >
            Stop camera
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="glass rounded-xl p-4 border border-white/10 space-y-4 text-sm">
          <h3 className="font-semibold text-mint">Recording Settings</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-slate-400">Resolution Height (px)</span>
              <select
                value={resolutionHeight}
                onChange={(e) => setResolutionHeight(Number(e.target.value))}
                className="bg-white/5 border border-white/10 rounded px-2 py-1"
              >
                <option value={360}>360p</option>
                <option value={480}>480p</option>
                <option value={720}>720p</option>
                <option value={1080}>1080p</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-slate-400">Target FPS</span>
              <select
                value={targetFps}
                onChange={(e) => setTargetFps(Number(e.target.value))}
                className="bg-white/5 border border-white/10 rounded px-2 py-1"
              >
                <option value={15}>15 fps</option>
                <option value={24}>24 fps</option>
                <option value={30}>30 fps</option>
                <option value={60}>60 fps</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-slate-400">Bitrate (bps)</span>
              <select
                value={bitrate}
                onChange={(e) => setBitrate(Number(e.target.value))}
                className="bg-white/5 border border-white/10 rounded px-2 py-1"
              >
                <option value={250000}>0.25 Mbps (Low)</option>
                <option value={500000}>0.5 Mbps (Medium)</option>
                <option value={1000000}>1.0 Mbps (High)</option>
                <option value={2500000}>2.5 Mbps (HD)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-slate-400">Max File Size (MB)</span>
              <input
                type="number"
                value={maxFileSizeMB}
                onChange={(e) => setMaxFileSizeMB(Number(e.target.value))}
                className="bg-white/5 border border-white/10 rounded px-2 py-1"
              />
            </label>
          </div>
          <div className="mt-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={enableClassifier}
                onChange={(e) => setEnableClassifier(e.target.checked)}
                className="accent-mint"
              />
              <span className="text-slate-200">Enable Post-Processing Classifier (SpeciesNet)</span>
            </label>
            <p className="text-xs text-slate-500 ml-6 mt-1">
              If enabled, runs a second pass on captured clips to identify specific species. Requires more memory.
            </p>
          </div>
          <p className="text-xs text-slate-500">
            Note: Actual resolution and FPS depend on camera hardware capabilities. Bitrate is a target for the encoder.
          </p>
        </div>
      )}

      <div className="glass rounded-2xl p-4 border border-white/10 space-y-3">
        <div className="flex flex-wrap gap-3 text-sm">
          <StatusPill label="Model" value={modelReady ? "Ready" : "Loading"} tone={modelReady ? "good" : "warn"} />
          <StatusPill label="Classifier" value={classifierReady ? "Ready" : "Loading"} tone={classifierReady ? "good" : "warn"} />
          <StatusPill label="Camera" value={cameraReady ? "Streaming" : "Idle"} tone={cameraReady ? "good" : "warn"} />
          <StatusPill label="Recording" value={recording ? "On" : "Off"} tone={recording ? "warn" : "muted"} />
          <StatusPill label="FPS" value={fps ? `${fps}` : "—"} tone="muted" />
          <StatusPill label="Detections" value={detectionSummary || "None"} tone="muted" />
          <StatusPill
            label="Classifier (post-rec)"
            value={!enableClassifier ? "Disabled" : classifierReady ? "Ready" : "Loading"}
            tone={!enableClassifier ? "muted" : classifierReady ? "good" : "warn"}
          />
        </div>

        {recording && (
          <div className="w-full bg-white/10 rounded-full h-2.5 dark:bg-gray-700 mt-2">
            <div
              className="bg-mint h-2.5 rounded-full transition-all duration-500"
              style={{ width: `${Math.min((currentSizeMB / maxFileSizeMB) * 100, 100)}%` }}
            ></div>
            <p className="text-xs text-right text-slate-400 mt-1">
              {currentSizeMB.toFixed(1)} / {maxFileSizeMB} MB
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-3 text-sm items-center">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoRecord}
              onChange={(e) => setAutoRecord(e.target.checked)}
              className="accent-mint"
            />
            Auto start/stop
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoUpload}
              onChange={(e) => setAutoUpload(e.target.checked)}
              className="accent-mint"
            />
            Auto upload
          </label>
          <label className="flex items-center gap-2">
            <span className="text-slate-400">Device ID</span>
            <input
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm"
              placeholder="device-123"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={startRecording}
              className="px-3 py-2 rounded-lg border border-white/20 text-slate-200 hover:border-white/40"
            >
              Start recording
            </button>
            <button
              type="button"
              onClick={stopRecording}
              className="px-3 py-2 rounded-lg border border-red-400/40 text-red-200 hover:border-red-400/70"
            >
              Stop recording
            </button>
          </div>
        </div>

        {status ? <p className="text-sm text-slate-300">{status}</p> : null}
        {modelError ? <p className="text-sm text-red-400">Model error: {modelError}</p> : null}
        {classifierError ? <p className="text-sm text-red-400">Classifier error: {classifierError}</p> : null}
        {isMounted && !SUPPORTED ? (
          <p className="text-sm text-red-400">
            Browser APIs not available here. Open this page in a browser to use camera + MediaRecorder.
          </p>
        ) : null}
      </div>

      <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-black">
        <canvas
          ref={displayCanvasRef}
          className="w-full h-full"
          style={{ aspectRatio: "16 / 9" }}
        />
        <video ref={videoRef} className="hidden" muted playsInline />
        <canvas ref={inferenceCanvasRef} className="hidden" width={inputSize} height={inputSize} />
        <canvas ref={classifierCanvasRef} className="hidden" width={224} height={224} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="glass rounded-xl p-4 border border-white/10 space-y-2">
          <h3 className="font-semibold text-mint">Live counts</h3>
          {Object.keys(liveCounts).length ? (
            <div className="flex flex-wrap gap-2">
              {Object.entries(liveCounts).map(([species, count]) => (
                <span key={species} className="pill bg-white/5 text-slate-200">
                  {species} · {count}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No detections yet</p>
          )}
        </div>

        <div className="glass rounded-xl p-4 border border-white/10 space-y-2">
          <h3 className="font-semibold text-mint">Max counts (current clip)</h3>
          {Object.keys(maxCounts).length ? (
            <div className="flex flex-wrap gap-2">
              {Object.entries(maxCounts).map(([species, count]) => (
                <span key={species} className="pill bg-white/5 text-slate-200">
                  {species} · {count}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Waiting for recording</p>
          )}
        </div>

        <div className="glass rounded-xl p-4 border border-white/10 space-y-4">
          <h3 className="font-semibold text-mint">Recent Captures ({captures.length})</h3>

          <div className="space-y-6">
            {captures.map((clip) => (
              <div key={clip.id} className="border-b border-white/10 pb-4 last:border-0">
                <div className="flex justify-between text-sm text-slate-400 mb-2">
                  <span>{clip.startedAt.toLocaleTimeString()}</span>
                  <span>{clip.framesWithAnimals} frames w/ animals</span>
                </div>

                <video src={clip.url} controls className="w-full rounded-lg border border-white/10 mb-2" />

                {/* Status Row */}
                <div className="flex flex-wrap gap-3 items-center text-sm">
                  {/* Classification Status */}
                  {!clip.classificationComplete ? (
                    <span className="text-amber-300 flex items-center gap-1">
                      <span className="animate-spin">⏳</span> Classifying {clip.classificationProgress}
                    </span>
                  ) : clip.classificationError ? (
                    <span className="text-red-400">❌ {clip.classificationError}</span>
                  ) : (
                    <span className="text-mint">✅ Classified</span>
                  )}

                  {/* Upload Status */}
                  {clip.uploadStatus === "uploading" && <span className="text-blue-300">☁️ Uploading...</span>}
                  {clip.uploadStatus === "success" && <span className="text-mint">☁️ Uploaded</span>}
                  {clip.uploadStatus === "error" && <span className="text-red-400">⚠️ Upload Failed</span>}

                  {/* Manual Upload Button */}
                  {clip.uploadStatus !== "success" && clip.uploadStatus !== "uploading" && (
                    <button onClick={() => processUpload(clip)} className="text-xs bg-white/10 px-2 py-1 rounded hover:bg-white/20">
                      Upload
                    </button>
                  )}
                </div>

                {/* Species Tags */}
                {clip.classificationComplete && !clip.classificationError && (
                  <div className="flex gap-2 mt-2">
                    {Object.entries(clip.speciesCounts).map(([s, c]) => (
                      <span key={s} className="text-xs bg-mint/20 text-mint px-2 py-0.5 rounded">{s} ({c})</span>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {captures.length === 0 && <p className="text-slate-500 text-sm">No recordings yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

type StatusTone = "good" | "warn" | "muted";

function StatusPill({ label, value, tone }: { label: string; value: string; tone: StatusTone }) {
  const toneClasses: Record<StatusTone, string> = {
    good: "bg-mint/20 border-mint/30 text-mint",
    warn: "bg-amber-500/20 border-amber-400/40 text-amber-100",
    muted: "bg-white/5 border-white/10 text-slate-200",
  };
  return (
    <span className={`pill border ${toneClasses[tone]}`}>
      {label}: {value}
    </span>
  );
}

function drawDetections(ctx: CanvasRenderingContext2D, detections: Detection[], scaleX: number, scaleY: number) {
  detections.forEach((det) => {
    const [x1, y1, x2, y2] = det.box;
    const sx1 = x1 * scaleX;
    const sy1 = y1 * scaleY;
    const sx2 = x2 * scaleX;
    const sy2 = y2 * scaleY;
    ctx.strokeStyle = "rgba(126, 242, 200, 0.9)";
    ctx.lineWidth = 2;
    ctx.strokeRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
    const label = `${det.label} ${(det.score * 100).toFixed(1)}%`;
    ctx.font = "12px monospace";
    const padding = 4;
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(10, 20, 30, 0.8)";
    ctx.fillRect(sx1, sy1 - 20, textWidth + padding * 2, 20);
    ctx.fillStyle = "#7ef2c8";
    ctx.fillText(label, sx1 + padding, sy1 - 5);
  });
}

function toCounts(detections: Detection[]): SpeciesCounts {
  const counts: SpeciesCounts = {};
  for (const det of detections) {
    const key = det.label || `class_${det.classId}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function bumpSpeciesMax(target: SpeciesCounts, observed: SpeciesCounts) {
  for (const [species, count] of Object.entries(observed)) {
    target[species] = Math.max(target[species] || 0, count);
  }
}

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        resolve(blob);
      },
      "image/jpeg",
      0.85,
    );
  });
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  // Prefer H.264 for better compatibility and compression if available
  const options = [
    "video/mp4",
    "video/webm;codecs=h264",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return options.find((type) => MediaRecorder.isTypeSupported(type));
}

