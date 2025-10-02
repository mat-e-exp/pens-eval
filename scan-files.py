#!/usr/bin/env python3
import os
import json
from datetime import datetime

data_dir = 'data/'
files = []

# Scan both test and live subdirectories
subdirs = ['test', 'live']

for subdir in subdirs:
    subdir_path = os.path.join(data_dir, subdir)
    if os.path.exists(subdir_path):
        for file in os.listdir(subdir_path):
            if file.endswith('.csv'):
                filepath = os.path.join(subdir_path, file)
                files.append({
                    'name': f'[{subdir.upper()}] {file}',
                    'path': filepath,
                    'size': os.path.getsize(filepath),
                    'modified': datetime.fromtimestamp(os.path.getmtime(filepath)).strftime('%Y-%m-%d %H:%M:%S'),
                    'environment': subdir
                })

# Write to JSON file
with open('file-list.json', 'w') as f:
    json.dump({'files': sorted(files, key=lambda x: x['modified'], reverse=True)}, f)

print(f"Found {len(files)} CSV file(s) in test and live folders")