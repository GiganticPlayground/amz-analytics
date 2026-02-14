#!/bin/bash
#
# Download analytics data from S3 and convert to CSV
#
# Usage:
#   ./download_and_convert.sh 2024-02-13
#   ./download_and_convert.sh 2024-02-13 my-bucket-name
#

set -e  # Exit on error

# Configuration
DEFAULT_BUCKET="YOUR_BUCKET_NAME"  # Replace with your actual bucket name
DATA_PREFIX="data"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
if [ $# -lt 1 ]; then
    echo -e "${RED}Error: Date required${NC}"
    echo "Usage: $0 <YYYY-MM-DD> [bucket-name]"
    echo ""
    echo "Examples:"
    echo "  $0 2024-02-13"
    echo "  $0 2024-02-13 my-analytics-bucket"
    exit 1
fi

DATE=$1
BUCKET=${2:-$DEFAULT_BUCKET}

# Validate date format
if ! [[ $DATE =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo -e "${RED}Error: Invalid date format${NC}"
    echo "Expected format: YYYY-MM-DD"
    echo "Example: 2024-02-13"
    exit 1
fi

# Parse date components
YEAR=$(echo $DATE | cut -d- -f1)
MONTH=$(echo $DATE | cut -d- -f2)
DAY=$(echo $DATE | cut -d- -f3)

# Remove leading zeros for S3 path (some configurations use this)
# MONTH_NO_ZERO=$(echo $MONTH | sed 's/^0*//')
# DAY_NO_ZERO=$(echo $DAY | sed 's/^0*//')

# S3 path with partition format
S3_PREFIX="$DATA_PREFIX/year=$YEAR/month=$MONTH/day=$DAY"

# Local directories
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RAW_DATA_DIR="$PROJECT_ROOT/analytics_data/raw/$DATE"
CSV_OUTPUT_DIR="$PROJECT_ROOT/analytics_data/csv"
COMBINED_CSV="$CSV_OUTPUT_DIR/${DATE}_combined.csv"

echo -e "${GREEN}=== Analytics Data Download & Conversion ===${NC}"
echo "Date: $DATE"
echo "Bucket: s3://$BUCKET"
echo "S3 Path: $S3_PREFIX"
echo ""

# Create directories
mkdir -p "$RAW_DATA_DIR"
mkdir -p "$CSV_OUTPUT_DIR"

# Check if AWS CLI is available
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI not found${NC}"
    echo "Install: https://aws.amazon.com/cli/"
    exit 1
fi

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: Python 3 not found${NC}"
    exit 1
fi

# Download data from S3
echo -e "${YELLOW}Step 1: Downloading from S3...${NC}"
aws s3 sync \
    "s3://$BUCKET/$S3_PREFIX/" \
    "$RAW_DATA_DIR/" \
    --quiet

# Check if any files were downloaded
FILE_COUNT=$(find "$RAW_DATA_DIR" -type f \( -name "*.json" -o -name "*.gz" \) 2>/dev/null | wc -l | tr -d ' ')

if [ "$FILE_COUNT" -eq 0 ]; then
    echo -e "${RED}Error: No data files found${NC}"
    echo "Checked path: s3://$BUCKET/$S3_PREFIX/"
    echo ""
    echo "Possible issues:"
    echo "  1. No data exists for this date"
    echo "  2. Bucket name is incorrect"
    echo "  3. S3 path format is different"
    echo "  4. AWS credentials not configured"
    echo ""
    echo "Try listing the bucket:"
    echo "  aws s3 ls s3://$BUCKET/$DATA_PREFIX/"
    exit 1
fi

echo -e "${GREEN}✓ Downloaded $FILE_COUNT files${NC}"
echo ""

# Decompress gzipped files if any
GZIP_COUNT=$(find "$RAW_DATA_DIR" -type f -name "*.gz" 2>/dev/null | wc -l | tr -d ' ')
if [ "$GZIP_COUNT" -gt 0 ]; then
    echo -e "${YELLOW}Step 2: Decompressing $GZIP_COUNT gzip files...${NC}"
    find "$RAW_DATA_DIR" -type f -name "*.gz" -exec gunzip {} \;
    echo -e "${GREEN}✓ Decompressed${NC}"
    echo ""
fi

# Convert to CSV
echo -e "${YELLOW}Step 3: Converting to CSV...${NC}"
python3 "$SCRIPT_DIR/json_to_csv.py" \
    "$RAW_DATA_DIR" \
    "$COMBINED_CSV"

echo ""
echo -e "${GREEN}=== Conversion Complete ===${NC}"
echo ""
echo "Output file: $COMBINED_CSV"
echo "File size: $(du -h "$COMBINED_CSV" | cut -f1)"
echo "Record count: $(tail -n +2 "$COMBINED_CSV" | wc -l | tr -d ' ')"
echo ""
echo "Next steps:"
echo "  1. Review: less $COMBINED_CSV"
echo "  2. Import into your analytics tool"
echo "  3. Archive: mv $COMBINED_CSV /path/to/archives/"
echo ""

# Ask if user wants to clean up raw data
read -p "Delete raw JSON files? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$RAW_DATA_DIR"
    echo -e "${GREEN}✓ Cleaned up raw data${NC}"
fi

echo -e "${GREEN}Done!${NC}"
