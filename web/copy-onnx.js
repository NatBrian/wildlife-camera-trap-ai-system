const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'node_modules', 'onnxruntime-web', 'dist');
const destDir = path.join(__dirname, 'public', 'onnxruntime');

if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
}

const files = fs.readdirSync(srcDir);

files.forEach(file => {
    if (file.endsWith('.wasm') || file.endsWith('.mjs') || file === 'ort.all.min.js') {
        const src = path.join(srcDir, file);
        const dest = path.join(destDir, file);
        fs.copyFileSync(src, dest);
        console.log(`Copied ${file} to public/onnxruntime/`);
    }
});
