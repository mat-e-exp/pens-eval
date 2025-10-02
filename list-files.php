<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$dataDir = 'data/';
$files = [];

if (is_dir($dataDir)) {
    $dir = scandir($dataDir);
    foreach ($dir as $file) {
        if (pathinfo($file, PATHINFO_EXTENSION) === 'csv') {
            $files[] = [
                'name' => $file,
                'path' => $dataDir . $file,
                'size' => filesize($dataDir . $file),
                'modified' => date("Y-m-d H:i:s", filemtime($dataDir . $file))
            ];
        }
    }
}

echo json_encode(['files' => $files]);
?>