#!/usr/bin/env python3
"""
Convert JSONL (JSON Lines) files from Kinesis Firehose to CSV format.

Usage:
    python json_to_csv.py input.json output.csv
    python json_to_csv.py input_dir/ output.csv  # Process all JSON files in directory
"""

import json
import csv
import sys
from pathlib import Path
from typing import List, Dict, Any, Set


def flatten_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """
    Flatten a record by extracting metricAttributes into top-level fields.

    Args:
        record: Original event record with nested metricAttributes

    Returns:
        Flattened record with attr_* fields
    """
    flattened = record.copy()

    # Flatten metricAttributes if it exists
    if 'metricAttributes' in flattened:
        attrs = flattened['metricAttributes']

        # Handle case where metricAttributes is a string (JSON-encoded)
        if isinstance(attrs, str):
            try:
                attrs = json.loads(attrs)
            except json.JSONDecodeError:
                pass  # Keep as string if not valid JSON

        # Extract attributes to top-level fields with attr_ prefix
        if isinstance(attrs, dict):
            for key, value in attrs.items():
                flattened[f'attr_{key}'] = value
            del flattened['metricAttributes']
        else:
            # If metricAttributes is not a dict, keep it as-is
            pass

    return flattened


def read_jsonl_file(filepath: Path) -> tuple[List[Dict[str, Any]], Set[str]]:
    """
    Read JSONL file and collect all records and fields.

    Args:
        filepath: Path to JSONL file

    Returns:
        Tuple of (records, all_fields)
    """
    records = []
    all_fields = set()

    with open(filepath, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue

            try:
                record = json.loads(line)
                flattened = flatten_record(record)
                records.append(flattened)
                all_fields.update(flattened.keys())
            except json.JSONDecodeError as e:
                print(f"Warning: Skipping invalid JSON at line {line_num}: {e}", file=sys.stderr)
                continue

    return records, all_fields


def process_json_files(input_path: Path) -> tuple[List[Dict[str, Any]], Set[str]]:
    """
    Process single JSON file or all JSON files in a directory.

    Args:
        input_path: Path to file or directory

    Returns:
        Tuple of (all_records, all_fields)
    """
    all_records = []
    all_fields = set()

    if input_path.is_file():
        # Single file
        records, fields = read_jsonl_file(input_path)
        all_records.extend(records)
        all_fields.update(fields)
        print(f"Processed {len(records)} records from {input_path.name}")
    elif input_path.is_dir():
        # Directory - process all .json files
        json_files = sorted(input_path.glob('*.json'))
        if not json_files:
            print(f"Error: No .json files found in {input_path}", file=sys.stderr)
            return [], set()

        for json_file in json_files:
            records, fields = read_jsonl_file(json_file)
            all_records.extend(records)
            all_fields.update(fields)
            print(f"Processed {len(records)} records from {json_file.name}")
    else:
        print(f"Error: {input_path} is neither a file nor directory", file=sys.stderr)
        return [], set()

    return all_records, all_fields


def get_field_order(fields: Set[str]) -> List[str]:
    """
    Order fields for consistent CSV output.

    Priority order:
    1. Core fields (timestamp, sessionId, metricName, etc.)
    2. Device fields
    3. Attribute fields (attr_*)
    4. Everything else

    Args:
        fields: Set of all field names

    Returns:
        Ordered list of field names
    """
    # Define priority order for core fields
    core_fields = [
        'timestamp', 'sessionId', 'metricName', 'value', 'demoContentId',
        'device', 'deviceCodename', 'language', 'connected', 'banyan',
        'simplified', 'retailer', 'gitCommitSha', 'gitBranch',
        'isVegaPlatform', 'userAgent', 'demoExperimentGroup'
    ]

    # Separate fields into categories
    ordered = []
    attr_fields = []
    other_fields = []

    for field in fields:
        if field in core_fields:
            continue  # Will add from core_fields list
        elif field.startswith('attr_'):
            attr_fields.append(field)
        else:
            other_fields.append(field)

    # Build final order
    for field in core_fields:
        if field in fields:
            ordered.append(field)

    ordered.extend(sorted(attr_fields))
    ordered.extend(sorted(other_fields))

    return ordered


def write_csv(records: List[Dict[str, Any]], fieldnames: List[str], output_path: Path):
    """
    Write records to CSV file.

    Args:
        records: List of flattened records
        fieldnames: Ordered list of field names
        output_path: Path to output CSV file
    """
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(records)

    print(f"\n✅ Successfully wrote {len(records)} records to {output_path}")
    print(f"   Columns: {len(fieldnames)}")


def main():
    if len(sys.argv) != 3:
        print("Usage: python json_to_csv.py <input.json|input_dir> <output.csv>")
        print("\nExamples:")
        print("  python json_to_csv.py data.json output.csv")
        print("  python json_to_csv.py ./raw_data/ combined.csv")
        sys.exit(1)

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    if not input_path.exists():
        print(f"Error: Input path does not exist: {input_path}", file=sys.stderr)
        sys.exit(1)

    # Process input files
    print(f"Processing: {input_path}")
    records, all_fields = process_json_files(input_path)

    if not records:
        print("Error: No records found", file=sys.stderr)
        sys.exit(1)

    # Order fields for consistent output
    fieldnames = get_field_order(all_fields)

    # Write CSV
    write_csv(records, fieldnames, output_path)

    # Print summary
    print(f"\n📊 Summary:")
    print(f"   Total records: {len(records):,}")
    print(f"   Total columns: {len(fieldnames)}")
    print(f"   Attribute columns: {len([f for f in fieldnames if f.startswith('attr_')])}")


if __name__ == '__main__':
    main()
