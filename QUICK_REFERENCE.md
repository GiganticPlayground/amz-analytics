# Quick Reference

Fast commands for common tasks.

## Deployment

```bash
# Deploy infrastructure
cd infrastructure
aws cloudformation create-stack \
  --stack-name my-analytics-api \
  --template-body file://api-with-lambda.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters ParameterKey=FirehoseStreamName,ParameterValue=YOUR_STREAM \
  --region us-west-1

# Get API endpoint
aws cloudformation describe-stacks \
  --stack-name my-analytics-api \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text
```

## Testing

```bash
# Test API endpoint
./scripts/test_api.sh https://YOUR-API.execute-api.us-west-1.amazonaws.com/events

# Test Lambda directly
aws lambda invoke \
  --function-name prod-analytics-forwarder \
  --payload '{"metricName":"test"}' \
  response.json
```

## Data Export

```bash
# Download and convert to CSV (single date)
./scripts/download_and_convert.sh 2024-02-13 YOUR_BUCKET

# Manual JSON to CSV
python3 scripts/json_to_csv.py input.json output.csv

# Download raw from S3
aws s3 sync s3://YOUR_BUCKET/data/year=2024/month=02/day=13/ ./local/
```

## Monitoring

```bash
# View Lambda logs (live)
aws logs tail /aws/lambda/prod-analytics-forwarder --follow

# Search for errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/prod-analytics-forwarder \
  --filter-pattern "ERROR"

# Check Firehose status
aws firehose describe-delivery-stream \
  --delivery-stream-name YOUR_STREAM
```

## App Integration

```typescript
// Initialize once at app startup
import { initializeAnalytics, trackEvent, metricName } from './amzAnalytics';

initializeAnalytics({
  endpoint: 'https://YOUR-API.execute-api.us-west-1.amazonaws.com/events',
  enabled: true,
  batchSize: 25,
  batchTimeout: 30000
});

// Track events
trackEvent(
  metricName.ContentElementInteraction,
  undefined,
  'ButtonClicked-123',
  JSON.stringify({ action: 'click', button: 'submit' })
);
```

## Common S3 Paths

```bash
# List recent data
aws s3 ls s3://YOUR_BUCKET/data/ --recursive | tail -20

# Today's data
aws s3 ls s3://YOUR_BUCKET/data/year=$(date +%Y)/month=$(date +%m)/day=$(date +%d)/

# Download today's data
aws s3 sync \
  s3://YOUR_BUCKET/data/year=$(date +%Y)/month=$(date +%m)/day=$(date +%d)/ \
  ./today/
```

## Troubleshooting

```bash
# Check if API is accessible
curl -X POST https://YOUR-API.execute-api.us-west-1.amazonaws.com/events \
  -H "Content-Type: application/json" \
  -d '{"test":"data"}'

# Validate JSON file
cat file.json | jq '.'

# Count events in JSON file
wc -l < file.json

# Check Lambda execution time
aws logs filter-log-events \
  --log-group-name /aws/lambda/prod-analytics-forwarder \
  --filter-pattern "Duration:"
```

## Useful CloudWatch Queries

```bash
# Lambda invocations (last 24h)
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=prod-analytics-forwarder \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum

# Lambda errors
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=prod-analytics-forwarder \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum
```

## File Locations

```
amz-analytics/
├── infrastructure/api-with-lambda.yaml   # CloudFormation template
├── scripts/
│   ├── test_api.sh                      # Test API endpoint
│   ├── json_to_csv.py                   # Convert JSON to CSV
│   └── download_and_convert.sh          # Automated export
├── src/amzAnalytics.ts                  # TypeScript module
└── docs/
    ├── SETUP.md                         # Deployment guide
    ├── INTEGRATION.md                   # App integration
    └── TROUBLESHOOTING.md               # Common issues
```

## Environment Variables

```bash
# App configuration (.env)
VITE_ANALYTICS_ENDPOINT=https://YOUR-API.execute-api.us-west-1.amazonaws.com/events
VITE_ENABLE_CSV_ANALYTICS=true
VITE_ANALYTICS_BATCH_SIZE=25
VITE_ANALYTICS_BATCH_TIMEOUT=30000
```

## CSV Schema

Core fields: `timestamp`, `sessionId`, `metricName`, `value`, `demoContentId`, `device`, `deviceCodename`, `language`, `serverTimestamp`

Dynamic fields: `attr_*` (flattened from metricAttributes)

## Cost Estimates

- 10M events/month: ~$15-20
- 100M events/month: ~$150-200
- 1B events/month: ~$1,500-2,000

## Important Links

- CloudFormation Console: https://console.aws.amazon.com/cloudformation
- Lambda Console: https://console.aws.amazon.com/lambda
- Firehose Console: https://console.aws.amazon.com/firehose
- S3 Console: https://console.aws.amazon.com/s3
- CloudWatch Logs: https://console.aws.amazon.com/cloudwatch
