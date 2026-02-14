# Troubleshooting Guide

Common issues and solutions for the AMZ Analytics pipeline.

## Table of Contents

- [Stack Creation Issues](#stack-creation-issues)
- [API Issues](#api-issues)
- [Data Not Appearing in S3](#data-not-appearing-in-s3)
- [App Integration Issues](#app-integration-issues)
- [CSV Conversion Issues](#csv-conversion-issues)
- [Performance Issues](#performance-issues)

---

## Stack Creation Issues

### Error: "Resource handler returned message: URI should not be specified for AWS_PROXY..."

**Problem**: Using AWS_PROXY integration with incompatible configuration.

**Solution**: Use the latest `api-with-lambda.yaml` template which uses Lambda as a proxy.

### Error: "HTTP API may only be associated with proxy integrations"

**Problem**: Trying to use direct AWS service integration with HTTP API.

**Solution**: HTTP APIs only support proxy integrations. The Lambda-based solution is required.

### Error: "IAM resources not acknowledged"

**Problem**: CloudFormation needs explicit permission to create IAM roles.

**Solution**:
- Via CLI: Add `--capabilities CAPABILITY_NAMED_IAM`
- Via Console: Check the IAM acknowledgment checkbox

### Error: "Stack rollback complete"

**Problem**: Stack creation failed.

**Solution**:
1. Go to CloudFormation console
2. Click on the failed stack
3. Go to **Events** tab
4. Find the first `CREATE_FAILED` event
5. Read the **Status reason** column
6. Fix the issue and try again

---

## API Issues

### 403 Forbidden

**Possible Causes**:

1. **CORS Error**
   - Check browser console for CORS-related errors
   - Verify API Gateway CORS settings
   - Ensure preflight OPTIONS requests are handled

2. **Wrong Endpoint**
   - Verify URL ends with `/events`
   - Check region matches (e.g., us-west-1)

**Solution**:
```bash
# Get the correct endpoint
aws cloudformation describe-stacks \
  --stack-name my-analytics-api \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text
```

### 500 Internal Server Error

**Problem**: Lambda execution error.

**Solution**:
1. Check CloudWatch Logs:
   ```bash
   aws logs tail /aws/lambda/prod-analytics-forwarder --follow
   ```

2. Common causes:
   - Firehose stream name incorrect
   - IAM permissions missing
   - Lambda timeout (increase in template)
   - Malformed JSON in request

### 504 Gateway Timeout

**Problem**: Lambda execution took too long.

**Solution**:
1. Check Lambda execution time in CloudWatch
2. Increase Lambda timeout in CloudFormation template
3. Check Firehose stream is responding

---

## Data Not Appearing in S3

### Wait Time

**Problem**: Data hasn't appeared yet.

**Solution**: Firehose buffers data. Wait:
- 5 minutes (default buffer interval), OR
- Until 5 MB of data collected

### Check Firehose Monitoring

1. Go to **Kinesis Console** → **Delivery streams**
2. Click on your stream
3. Go to **Monitoring** tab
4. Check for:
   - **Incoming records** - Should be > 0
   - **Delivery to S3 success** - Should be 100%
   - **Errors** - Should be 0

### Check Lambda Logs

```bash
# View recent logs
aws logs tail /aws/lambda/prod-analytics-forwarder --follow

# Search for errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/prod-analytics-forwarder \
  --filter-pattern "ERROR"
```

### Verify Firehose Configuration

1. **Stream Name**: Must match exactly in CloudFormation
2. **S3 Bucket**: Must exist and be accessible
3. **IAM Role**: Firehose must have permission to write to S3
4. **Region**: All resources must be in same region

### Force Flush (Testing)

Can't force flush, but you can send enough data to trigger the 5 MB limit:

```bash
# Send 100 test events
for i in {1..100}; do
  ./scripts/test_api.sh YOUR_ENDPOINT
  sleep 0.1
done
```

---

## App Integration Issues

### Events Not Being Sent

**Check Browser Console**:
1. Open DevTools → Console
2. Look for:
   - `[CSV Analytics] Event queued`
   - `[CSV Analytics] Batch sent successfully`
   - Any error messages

**Common Issues**:

1. **Analytics Not Initialized**
   ```typescript
   // Make sure this runs early
   initializeAnalytics({
     endpoint: 'YOUR_ENDPOINT',
     enabled: true
   });
   ```

2. **Wrong Endpoint URL**
   - Check `.env` file
   - Verify `VITE_ANALYTICS_ENDPOINT` is set
   - URL should end with `/events`

3. **CORS Errors**
   - Check API Gateway CORS configuration
   - Verify `Access-Control-Allow-Origin` includes your domain

### Events Not Batching

**Problem**: Each event sends immediately.

**Solution**: Check batch configuration:
```typescript
initializeAnalytics({
  endpoint: 'YOUR_ENDPOINT',
  enabled: true,
  batchSize: 25,        // Send after 25 events
  batchTimeout: 30000,  // Or 30 seconds
});
```

### Network Errors

**Check Network Tab**:
1. Open DevTools → Network
2. Filter for your API endpoint
3. Check:
   - Request status (should be 200)
   - Response body
   - Request headers (CORS)

**Common Network Issues**:
- Ad blockers blocking requests
- Network firewalls
- VPN issues
- Invalid SSL certificate

---

## CSV Conversion Issues

### "No records found"

**Problem**: Input JSON file is empty or malformed.

**Solution**:
1. Check file exists: `ls -la input.json`
2. Check contents: `head input.json`
3. Verify JSON format (one object per line)

### "Invalid JSON at line X"

**Problem**: Malformed JSON in input file.

**Solution**:
1. Find problematic line:
   ```bash
   sed -n 'Xp' input.json  # Replace X with line number
   ```
2. Validate JSON:
   ```bash
   cat input.json | jq '.'
   ```
3. The script will skip invalid lines and continue

### Missing Columns

**Problem**: Some expected columns missing from CSV.

**Solution**:
- Not all events have all fields
- CSV includes all fields found across all events
- Missing fields are left blank for specific rows

### Encoding Issues

**Problem**: Special characters not displaying correctly.

**Solution**:
- Script uses UTF-8 encoding
- Check your CSV viewer supports UTF-8
- Try: `file output.csv` to check encoding

---

## Performance Issues

### High Lambda Costs

**Possible Causes**:
- Too many invocations
- Long execution time
- High memory allocation

**Solutions**:
1. **Enable Batching** in app:
   ```typescript
   batchSize: 50,  // Increase batch size
   batchTimeout: 60000,  // Longer timeout
   ```

2. **Check Lambda Metrics**:
   ```bash
   aws cloudwatch get-metric-statistics \
     --namespace AWS/Lambda \
     --metric-name Invocations \
     --dimensions Name=FunctionName,Value=prod-analytics-forwarder \
     --start-time 2024-02-13T00:00:00Z \
     --end-time 2024-02-14T00:00:00Z \
     --period 3600 \
     --statistics Sum
   ```

3. **Optimize Lambda**:
   - Reduce timeout if not needed
   - Keep memory at 128 MB (usually sufficient)

### High API Gateway Costs

**Solution**: Increase client-side batching to reduce requests:
```typescript
batchSize: 100,  // Larger batches
batchTimeout: 60000,  // Less frequent sends
```

### High S3 Storage Costs

**Solutions**:
1. **Enable Compression** in Firehose (GZIP)
2. **Use Parquet** format (better compression)
3. **Lifecycle Policies**:
   ```json
   {
     "Rules": [{
       "Id": "Archive old data",
       "Status": "Enabled",
       "Transitions": [
         {"Days": 30, "StorageClass": "STANDARD_IA"},
         {"Days": 90, "StorageClass": "GLACIER"}
       ],
       "ExpirationInDays": 365
     }]
   }
   ```

### Slow CSV Conversion

**Problem**: Large files take long to convert.

**Solutions**:
1. **Process in Chunks**:
   ```bash
   split -l 100000 large.json chunk_
   for file in chunk_*; do
     python3 json_to_csv.py "$file" "${file}.csv"
   done
   ```

2. **Use Athena** for large-scale queries instead of downloading everything

---

## Debugging Tips

### Enable Verbose Logging

In `csvAnalytics.ts`:
```typescript
const DEBUG = true;  // Set to true

function log(...args: any[]) {
  if (DEBUG) {
    console.log('[CSV Analytics]', ...args);
  }
}
```

### Check Lambda Environment

```bash
aws lambda get-function-configuration \
  --function-name prod-analytics-forwarder \
  --region us-west-1
```

### Test Lambda Directly

```bash
aws lambda invoke \
  --function-name prod-analytics-forwarder \
  --payload '{"metricName":"test","timestamp":1707849600000}' \
  --region us-west-1 \
  response.json

cat response.json
```

### Check Firehose Status

```bash
aws firehose describe-delivery-stream \
  --delivery-stream-name YOUR_STREAM_NAME \
  --region us-west-1
```

### View API Gateway Logs

Enable logging in API Gateway:
```bash
aws apigatewayv2 update-stage \
  --api-id YOUR_API_ID \
  --stage-name '$default' \
  --access-log-settings DestinationArn=LOG_GROUP_ARN,Format='$context.requestId'
```

---

## Common Questions

### Q: How long until data appears in S3?

**A**: 5-10 minutes. Firehose buffers for 300 seconds OR 5 MB, whichever comes first.

### Q: Can I reduce the buffer time?

**A**: Yes, configure Firehose buffer settings:
- Minimum: 60 seconds
- Maximum: 900 seconds (15 minutes)

### Q: Why are some events missing?

**A**: Possible reasons:
1. Network failures (check browser console)
2. Lambda errors (check CloudWatch logs)
3. Firehose delivery failures (check Firehose monitoring)
4. Page unloaded before batch sent (use `sendBeacon`)

### Q: How do I test locally?

**A**:
1. Set up endpoint in `.env`
2. Run dev server
3. Interact with app
4. Check browser console for batch logs
5. Check Network tab for API calls

### Q: Can I use this in production?

**A**: Yes, but consider:
- Add API authentication
- Restrict CORS to your domains
- Set up CloudWatch alarms
- Enable S3 encryption
- Review IAM permissions

---

## Getting Help

If you're still stuck:

1. **Check CloudWatch Logs** first:
   - Lambda execution logs
   - API Gateway logs (if enabled)

2. **Review AWS Service Health**: https://status.aws.amazon.com/

3. **Check Documentation**:
   - [Setup Guide](SETUP.md)
   - [Integration Guide](INTEGRATION.md)
   - Main [README](../README.md)

4. **Common Log Patterns**:
   ```bash
   # Lambda errors
   aws logs filter-log-events \
     --log-group-name /aws/lambda/prod-analytics-forwarder \
     --filter-pattern "ERROR"

   # Lambda duration
   aws logs filter-log-events \
     --log-group-name /aws/lambda/prod-analytics-forwarder \
     --filter-pattern "Duration:"
   ```
