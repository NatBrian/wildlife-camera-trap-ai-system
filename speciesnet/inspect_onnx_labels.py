import onnx
import json
import sys
import io
import argparse
import os
import ast

# Force UTF-8
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

def inspect_and_extract(model_path, output_path=None):
    if not os.path.exists(model_path):
        print(f"Error: File not found at {model_path}")
        return

    print(f"Loading model: {model_path}")
    try:
        model = onnx.load(model_path)
    except Exception as e:
        print(f"Error loading model: {e}")
        return

    print("-" * 30)
    print("Model Metadata Properties:")
    print("-" * 30)
    
    labels_dict = None
    
    for prop in model.metadata_props:
        print(f"Key: {prop.key}")
        # print(f"Value: {prop.value[:200]}...") 
        
        if prop.key == 'names':
            print(">>> FOUND LABELS (names)")
            try:
                # Try parsing as JSON first (some exporters use valid JSON)
                labels_dict = json.loads(prop.value)
            except json.JSONDecodeError:
                # Common in YOLO exports: single quotes instead of double quotes
                try:
                    val = prop.value.replace("'", '"')
                    labels_dict = json.loads(val)
                except json.JSONDecodeError:
                    # Fallback to literal_eval for Python dictionary string representation
                    try:
                        labels_dict = ast.literal_eval(prop.value)
                    except Exception as e:
                        print(f"Error parsing 'names' value: {e}")
                        print(f"Raw value: {prop.value}")

    if labels_dict:
        print("-" * 30)
        print(f"Extracted {len(labels_dict)} labels:")
        
        # Normalize to list
        # Handle case where labels_dict is already a list (rare but possible)
        if isinstance(labels_dict, list):
            labels_list = labels_dict
        else:
            # Convert dict {0: 'a', 1: 'b'} to list ['a', 'b']
            max_idx = max(int(k) for k in labels_dict.keys())
            labels_list = [""] * (max_idx + 1)
            for k, v in labels_dict.items():
                labels_list[int(k)] = v
        
        # Print first few
        print(json.dumps(labels_list[:5], indent=2))
        if len(labels_list) > 5:
            print(f"... and {len(labels_list) - 5} more.")

        if output_path:
            print(f"\nSaving labels to {output_path}...")
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(labels_list, f, indent=2)
            print("Success!")
        else:
            print("\n(Use --output to save these labels to a JSON file)")
    else:
        print("\nNo 'names' metadata found in this model.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Inspect ONNX model metadata and extract labels.")
    parser.add_argument("model_path", help="Path to the ONNX model file")
    parser.add_argument("--output", "-o", help="Path to save extracted labels as JSON", default=None)
    
    args = parser.parse_args()
    inspect_and_extract(args.model_path, args.output)
