import onnx
from onnxruntime.quantization import quantize_dynamic, QuantType
import os
import sys

def quantize_speciesnet():
    input_model_path = r"web/public/models/speciesnet.onnx"
    output_model_path = r"web/public/models/speciesnet_quant.onnx"

    if not os.path.exists(input_model_path):
        # Try looking in speciesnet folder if not in web/public/models
        input_model_path = r"speciesnet/speciesnet.onnx"
        if not os.path.exists(input_model_path):
            print(f"Error: Input model not found at {input_model_path}")
            return

    print(f"Quantizing model: {input_model_path}")
    print(f"Output path: {output_model_path}")

    try:
        # Quantize to UINT8 (standard for image models)
        quantize_dynamic(
            input_model_path,
            output_model_path,
            weight_type=QuantType.QUInt8
        )
        
        original_size = os.path.getsize(input_model_path) / (1024 * 1024)
        quantized_size = os.path.getsize(output_model_path) / (1024 * 1024)
        
        print(f"Quantization complete!")
        print(f"Original size: {original_size:.2f} MB")
        print(f"Quantized size: {quantized_size:.2f} MB")
        print(f"Reduction: {(1 - quantized_size/original_size)*100:.1f}%")
        
    except Exception as e:
        print(f"Error during quantization: {e}")

if __name__ == "__main__":
    quantize_speciesnet()
