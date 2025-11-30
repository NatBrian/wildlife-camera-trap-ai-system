/** @type {import('next').NextConfig} */
const nextConfig = {
    webpack: (config) => {
        // Ignore node-specific modules when bundling for the browser
        config.resolve.alias = {
            ...config.resolve.alias,
            "onnxruntime-node$": false,
        };
        return config;
    },
};

export default nextConfig;
