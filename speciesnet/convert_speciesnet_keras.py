import os
import sys
import io

# Force legacy Keras (Keras 2) for compatibility with TFOpLambda and older models
os.environ["TF_USE_LEGACY_KERAS"] = "1"

import tensorflow as tf
import tf2onnx
import kagglehub

# Force UTF-8
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

def convert_keras_to_onnx():
    print("Downloading SpeciesNet Keras model...")
    try:
        # Download latest version
        path = kagglehub.model_download("google/speciesnet/keras/v4.0.0a")
        print("Path to model files:", path)
    except Exception as e:
        print(f"Error downloading model: {e}")
        return

    # Find the model file/directory
    # It might be a SavedModel directory or a .keras file
    model_path = path
    # Check if there's a specific file inside
    files = os.listdir(path)
    print(f"Files in download directory: {files}")
    
    # If there's a .keras file, use that. Otherwise assume the directory is a SavedModel.
    keras_files = [f for f in files if f.endswith('.keras') or f.endswith('.h5')]
    if keras_files:
        model_path = os.path.join(path, keras_files[0])
    
    print(f"Loading Keras model from {model_path}...")
    if not os.path.exists(model_path):
        print(f"ERROR: File does not exist at {model_path}")
        return
    print(f"File size: {os.path.getsize(model_path)} bytes")
    print(f"TF Version: {tf.__version__}")
    # print(f"Keras Version: {tf.keras.__version__}")

    # Check file header
    with open(model_path, 'rb') as f:
        header = f.read(4)
    print(f"File header: {header}")
    
    if header == b'PK\x03\x04':
        print("File appears to be a ZIP file (.keras format).")
    elif header.startswith(b'\x89HDF'):
        print("File appears to be an HDF5 file.")
        if not model_path.endswith('.h5'):
            print("Renaming to .h5 for Keras compatibility...")
            new_model_path = model_path.replace('.keras', '.h5')
            import shutil
            if model_path != new_model_path:
                shutil.copy2(model_path, new_model_path)
                model_path = new_model_path
                print(f"Using temporary file: {model_path}")
        else:
            print("File already has .h5 extension.")
    else:
        print("Unknown file format.")

    try:
        # Try loading with compile=False to avoid custom object issues
        model = tf.keras.models.load_model(model_path, compile=False)
        print("Model loaded successfully.")
        
        # Print input shape
        print(f"Model input shape: {model.input_shape}")
        
        output_path = "speciesnet.onnx"
        print(f"Converting to ONNX and saving to {output_path}...")
        
        # Convert
        spec = (tf.TensorSpec(model.input_shape, tf.float32, name="input"),)
        model_proto, _ = tf2onnx.convert.from_keras(model, input_signature=spec, opset=13, output_path=output_path)
        
        print(f"Success! Model exported to {os.path.abspath(output_path)}")
        
    except Exception as e:
        print(f"Error converting model: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    convert_keras_to_onnx()
