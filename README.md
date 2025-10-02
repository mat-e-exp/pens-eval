# Pension Evaluation Dashboard

A dynamic, visually rich web application for analyzing pension CSV data with interactive charts and animations.

## Features

### Data Input
- **Drag & Drop Interface**: Simply drag your pension CSV file onto the drop zone
- **File Upload**: Click to browse and select your file
- **Demo Mode**: Load sample data to explore features without uploading personal data
- **Multi-format Support**: Accepts CSV, XLS, and XLSX files

### Data Validation
- Automatic detection of required fields (date, value)
- Smart column mapping for different pension provider formats
- Clear error messages for data issues
- Preview of uploaded data before processing

### Analytics Dashboard

#### Key Statistics
- **Current Value**: Animated counter showing latest pension value
- **Total Contributions**: Sum of all personal and employer contributions
- **Growth Rate**: Overall percentage growth since inception
- **Projected Value**: Estimated value at retirement (age 65)

#### Interactive Charts
- **Value Over Time**: Line chart showing pension growth trajectory
- **Contribution Breakdown**: Doughnut chart showing personal vs employer contributions vs growth

### Visual Features
- Smooth animations and transitions
- Responsive design for all devices
- Gradient backgrounds and modern UI
- Hover effects and interactive elements
- Real-time value animations

## CSV Format

The dashboard expects a CSV with these columns (flexible naming supported):

### Required Fields
- `date` - Transaction/valuation date
- `value` or `balance` - Current pension value

### Optional Fields
- `personal_contribution` - Your contributions
- `employer_contribution` - Employer contributions
- `growth` or `return` - Investment growth

### Example CSV Structure
```csv
date,value,personal_contribution,employer_contribution,growth
2023-01-01,25000,200,200,50
2023-02-01,25450,200,200,50
```

## Usage

1. Open `index.html` in a web browser
2. Either:
   - Drag and drop your pension CSV file
   - Click to browse and select your file
   - Click "Load Demo Data" to explore with sample data
3. Review the data preview
4. Click "Process Data" to generate analytics
5. Explore your pension performance!

## Privacy

All data processing happens locally in your browser. No data is sent to any server.

## Future Enhancements

- Additional chart types (candlestick, heatmap, 3D projections)
- Multiple scenario modeling
- Fee analysis
- Retirement income simulator
- Export functionality
- Comparison with benchmarks