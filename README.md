# AMZ Analytics

A lightweight, cost-effective analytics pipeline for capturing browser events and storing them in S3 as CSV-ready data.

## Overview

This system provides a complete pipeline for collecting custom analytics from browser-based applications:

**Browser/App** → **API Gateway** → **Lambda** → **Kinesis Firehose** → **S3** → **CSV Export**

### Key Features

- ✅ **Cost-effective**: ~$15-20/month for 10M events
- ✅ **Simple integration**: Single TypeScript module
- ✅ **CSV output**: Ready for existing analytics tools
- ✅ **Batching**: Efficient event collection with configurable batching
- ✅ **Reliable**: Retry logic and error handling built-in
- ✅ **Flexible**: Works with any Kinesis Firehose destination

## Architecture

```
┌─────────────────┐
│   Browser App   │
│                 │
│  trackEvent()   │
└────────┬────────┘
         │
         │ HTTPS POST (batched)
         │
         ▼
┌─────────────────┐
│  API Gateway    │
│  (HTTP API)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Lambda         │
│  (Forwarder)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Kinesis         │
│ Firehose        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  S3 Bucket      │
│  (JSON/Parquet) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  CSV Export     │
│  (Your Tool)    │
└─────────────────┘
```

## Quick Start

### Prerequisites

- AWS Account
- AWS CLI configured
- Existing Kinesis Firehose stream (or create one)
- Node.js/TypeScript app

### 1. Deploy Infrastructure

```bash
# Deploy CloudFormation stack
cd infrastructure
aws cloudformation create-stack \
  --stack-name my-analytics-api \
  --template-body file://api-with-lambda.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters \
    ParameterKey=EnvironmentName,ParameterValue=prod \
    ParameterKey=FirehoseStreamName,ParameterValue=YOUR_FIREHOSE_STREAM_NAME \
  --region us-west-1
```

Wait for stack creation (~3 minutes):

```bash
aws cloudformation wait stack-create-complete \
  --stack-name my-analytics-api \
  --region us-west-1
```

Get your API endpoint:

```bash
aws cloudformation describe-stacks \
  --stack-name my-analytics-api \
  --region us-west-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text
```

### 2. Test the API

```bash
cd scripts
./test_api.sh https://YOUR-API-ID.execute-api.us-west-1.amazonaws.com/events
```

### 3. Integrate with Your App

Copy `src/amzAnalytics.ts` to your project and initialize:

```typescript
import { initializeAnalytics, trackEvent, MetricName } from './amzAnalytics';

// Initialize at app startup with your app's context
initializeAnalytics({
  endpoint: 'https://YOUR-API-ID.execute-api.us-west-1.amazonaws.com/events',
  enabled: true,
  batchSize: 25,        // Send after 25 events
  batchTimeout: 30000,  // Or after 30 seconds
  // Optional: Add context that will be included with every event
  context: {
    device: 'my-device',
    deviceCodename: 'my-code',
    language: 'en_us',
    appVersion: '1.0.0',
    gitCommitSha: 'abc123',
    // Add any custom fields you need
  }
});

// Track events
trackEvent(
  MetricName.ContentElementInteraction,
  undefined,
  'ButtonClicked-123',
  { action: 'click', button: 'submit' }  // Can pass object or JSON string
);
```

### 4. Download and Convert to CSV

After events have been collected (wait 5-10 minutes for Firehose to flush):

```bash
cd scripts
./download_and_convert.sh 2024-02-13 YOUR_BUCKET_NAME
```

Output: `analytics_data/csv/2024-02-13_combined.csv`

## Repository Structure

```
amz-analytics/
├── README.md                          # This file
├── infrastructure/
│   └── api-with-lambda.yaml          # CloudFormation template
├── scripts/
│   ├── test_api.sh                   # Test API endpoint
│   ├── json_to_csv.py                # Convert JSON to CSV
│   └── download_and_convert.sh       # Automated daily export
├── src/
│   └── amzAnalytics.ts               # TypeScript analytics module
└── docs/
    ├── SETUP.md                      # Detailed setup guide
    ├── INTEGRATION.md                # App integration guide
    └── TROUBLESHOOTING.md            # Common issues and solutions
```

## Features

### TypeScript Analytics Module

- **Batching**: Configurable batch size and timeout
- **Retry Logic**: Automatic retry with exponential backoff
- **Session Tracking**: Unique session IDs for each page load
- **Context Enrichment**: Adds device info, timestamps, etc.
- **Error Handling**: Graceful degradation on failures
- **Page Unload**: Uses `sendBeacon` for reliable delivery

### Infrastructure

- **HTTP API Gateway**: Low-cost, high-performance
- **Lambda Function**: Python-based forwarder with logging
- **IAM Roles**: Properly scoped permissions
- **CORS**: Configured for browser access
- **Throttling**: 2000 req/sec rate limit, 5000 burst

### CSV Export

- **Flattened Data**: Nested JSON converted to columns
- **Consistent Schema**: Predictable column order
- **Batch Processing**: Handle multiple files at once
- **Compression Support**: Automatic gzip decompression

## CSV Output Schema

| Column | Type | Description |
|--------|------|-------------|
| `timestamp` | bigint | Client timestamp (milliseconds) |
| `serverTimestamp` | string | Server timestamp (ISO 8601) |
| `sessionId` | string | Unique session identifier |
| `metricName` | string | Event type |
| `value` | number | Optional numeric value |
| `demoContentId` | string | Event identifier |
| `device` | string | Device information |
| `deviceCodename` | string | Device code |
| `language` | string | Language code |
| `attr_*` | various | Flattened metric attributes |

## Configuration

### Environment Variables

```bash
# Required
VITE_ANALYTICS_ENDPOINT=https://YOUR-API.execute-api.us-west-1.amazonaws.com/events
VITE_ENABLE_CSV_ANALYTICS=true

# Optional
VITE_ANALYTICS_BATCH_SIZE=25       # Default: 25
VITE_ANALYTICS_BATCH_TIMEOUT=30000 # Default: 30000ms
```

### CloudFormation Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `EnvironmentName` | `prod` | Environment identifier |
| `FirehoseStreamName` | - | Your Firehose stream name (required) |

## Cost Estimate

For **10 million events/month**:

| Service | Cost |
|---------|------|
| API Gateway (HTTP API) | ~$10 |
| Lambda (100ms avg) | ~$5 |
| Kinesis Firehose | ~$0.06 |
| S3 Storage (compressed) | ~$0.05 |
| **Total** | **~$15-20/month** |

## Use Cases

- Custom analytics for embedded devices
- A/B testing and experimentation
- User interaction tracking
- Performance monitoring
- Custom business metrics
- Replacement for third-party analytics

## Advantages Over Third-Party Analytics

- ✅ **Full data ownership**: All events in your S3
- ✅ **No sampling**: Every event captured
- ✅ **No PII concerns**: You control the data
- ✅ **Cost-effective**: Pay only for usage
- ✅ **Flexible analysis**: Export to any tool
- ✅ **No rate limits**: Scale to millions of events

## Documentation

- **[Setup Guide](docs/SETUP.md)** - Detailed deployment instructions
- **[Integration Guide](docs/INTEGRATION.md)** - How to integrate with your app
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** - Common issues and solutions

## Examples

### Basic Event Tracking

```typescript
trackEvent(
  MetricName.ContentPageLoad,
  undefined,
  'HomePage-loaded',
  {
    path: '/home',
    loadTime: 1234
  }
);
```

### With Numeric Value

```typescript
trackEvent(
  MetricName.ContentPlayDuration,
  15000,  // 15 seconds
  'VideoPlayed-abc123',
  {
    videoId: 'abc123',
    videoName: 'Tutorial'
  }
);
```

### Custom Attributes

```typescript
trackEvent(
  MetricName.ContentElementInteraction,
  undefined,
  'FormSubmitted-contact',
  {
    action: 'submit',
    formType: 'contact',
    fieldCount: 5,
    validationErrors: 0
  }
);
```

### Custom Metric Names

```typescript
// You can also use string literals for custom metric types
trackEvent(
  'MyCustomMetric',
  42,
  'custom-event-id',
  { customField: 'value' }
);
```

## Testing

```bash
# Test API endpoint
./scripts/test_api.sh YOUR_ENDPOINT

# Test CSV conversion
echo '{"test": "data"}' > /tmp/test.json
python3 scripts/json_to_csv.py /tmp/test.json /tmp/test.csv
cat /tmp/test.csv
```

## Contributing

This is an internal tool, but contributions are welcome:

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

Internal use only - Amazon

## Support

For issues or questions:
- Check the [Troubleshooting Guide](docs/TROUBLESHOOTING.md)
- Review CloudWatch Logs for Lambda
- Check Firehose monitoring in AWS Console

## Changelog

### v1.0.0 (2024-02-13)
- Initial release
- HTTP API + Lambda + Firehose integration
- TypeScript analytics module
- CSV export scripts
- Complete documentation
