import json
import os

def generate_labels_json():
    # Path to the labels file (hardcoded from previous step for convenience)
    labels_path = r"C:\Users\brian\.cache\kagglehub\models\google\speciesnet\keras\v4.0.0a\3\always_crop_99710272_22x8_v12_epoch_00148.labels.txt"
    
    if not os.path.exists(labels_path):
        print(f"Labels file not found at {labels_path}")
        return

    labels = []
    print(f"Reading labels from {labels_path}...")
    with open(labels_path, 'r', encoding='utf-8') as f:
        for line in f:
            parts = line.strip().split(';')
            if parts:
                # The last part is the common name
                common_name = parts[-1]
                labels.append(common_name)
    
    output_path = "speciesnet_labels.json"
    print(f"Writing {len(labels)} labels to {output_path}...")
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(labels, f, indent=2)
    
    print("Success!")

if __name__ == "__main__":
    generate_labels_json()
