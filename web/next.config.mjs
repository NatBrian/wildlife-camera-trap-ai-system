import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
    webpack: (config, { isServer }) => {
        // Ignore node-specific modules when bundling for the browser
        if (!isServer) {
            config.resolve.alias = {
                ...config.resolve.alias,
                "onnxruntime-node$": false,
                // Force usage of the browser bundle
                "onnxruntime-web$": path.join(__dirname, "node_modules", "onnxruntime-web", "dist", "ort.all.min.mjs"),
            };

            config.resolve.fallback = {
                ...config.resolve.fallback,
                fs: false,
                path: false,
                os: false,
                module: false,
            };
        }
        return config;
    },
};

export default nextConfig;
