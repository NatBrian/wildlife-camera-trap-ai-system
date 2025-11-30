"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Options = {
    modelUrl: string;
    labelsUrl?: string;
    inputSize?: number;
    preferBackend?: "webgpu" | "wasm";
    enabled?: boolean;
};

type ClassificationResult = {
    label: string;
    score: number;
    classId: number;
};

type UseClassifierResult = {
    ready: boolean;
    error: string | null;
    labels: string[];
    runClassifier: (image: ImageData) => Promise<ClassificationResult[]>;
};

export function useClassifier(options: Options): UseClassifierResult {
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [labels, setLabels] = useState<string[]>([]);
    const workerRef = useRef<Worker | null>(null);
    const pendingRequests = useRef<Map<string, { resolve: (d: ClassificationResult[]) => void; reject: (e: Error) => void }>>(new Map());

    useEffect(() => {
        if (options.enabled === false) {
            setReady(false);
            setError(null);
            return;
        }

        setReady(false);
        setError(null);

        const worker = new Worker(`/classifier.worker.js?v=${Date.now()}`);
        workerRef.current = worker;

        worker.onmessage = (e) => {
            const { type, payload, id } = e.data;

            if (type === "ready") {
                setReady(true);
                if (payload.labels) setLabels(payload.labels);
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
            console.error("Classifier Worker error:", err);
            setError("Classifier Worker error occurred");
        };

        worker.postMessage({
            type: "load",
            payload: {
                modelUrl: options.modelUrl,
                labelsUrl: options.labelsUrl,
                preferBackend: options.preferBackend,
                config: {
                    inputSize: options.inputSize,
                },
            },
        });

        return () => {
            worker.terminate();
            workerRef.current = null;
            pendingRequests.current.clear();
        };
    }, [options.modelUrl, options.labelsUrl, options.preferBackend, options.inputSize, options.enabled]);

    const runClassifier = useCallback(
        async (image: ImageData): Promise<ClassificationResult[]> => {
            if (!workerRef.current || !ready) throw new Error("Classifier not ready");

            const id = Math.random().toString(36).substring(7);

            return new Promise<ClassificationResult[]>((resolve, reject) => {
                pendingRequests.current.set(id, { resolve, reject });

                // Transfer buffer if possible, or just copy
                const data = image.data;

                workerRef.current?.postMessage(
                    {
                        type: "classify",
                        payload: {
                            data: data,
                            width: image.width,
                            height: image.height,
                        },
                        id,
                    },
                );
            });
        },
        [ready],
    );

    return { ready, error, labels, runClassifier };
}
