# Setup Guide

Complete guide to deploying the AMZ Analytics pipeline.

## Prerequisites

- AWS Account with appropriate permissions
- AWS CLI installed and configured
- Existing Kinesis Firehose stream (or create one)

## Step 1: Create or Configure Firehose

If you already have a Firehose stream, skip to Step 2.

### Create a New Firehose Stream

1. Go to **Kinesis Console** → **Delivery streams**
2. Click **Create delivery stream**
3. Configuration:
   - **Source**: Direct PUT
   - **Destination**: Amazon S3
   - **Name**: `my-analytics-firehose`
   - **S3 bucket**: Create new or select existing
   - **S3 prefix**: `data/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/`
   - **Buffer size**: 5 MB
   - **Buffer interval**: 300 seconds
   - **Compression**: GZIP
4. Click **Create delivery stream**

### Note Your Firehose Details

You'll need:
- **Stream name**: e.g., `my-analytics-firehose`
- **Stream ARN**: e.g., `arn:aws:firehose:us-west-1:123456789012:deliverystream/my-analytics-firehose`
- **S3 bucket name**: Where data will be stored
- **Region**: e.g., `us-west-1`

## Step 2: Deploy Infrastructure

### Option A: Via AWS CLI (Recommended)

```bash
cd infrastructure

# Deploy the stack
aws cloudformation create-stack \
  --stack-name my-analytics-api \
  --template-body file://api-with-lambda.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters \
    ParameterKey=EnvironmentName,ParameterValue=prod \
    ParameterKey=FirehoseStreamName,ParameterValue=YOUR_FIREHOSE_STREAM_NAME \
  --region us-west-1

# Wait for completion (takes ~3 minutes)
aws cloudformation wait stack-create-complete \
  --stack-name my-analytics-api \
  --region us-west-1

# Get the API endpoint
aws cloudformation describe-stacks \
  --stack-name my-analytics-api \
  --region us-west-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text
```

Save the API endpoint - you'll need it for app integration!

### Option B: Via AWS Console

1. **Go to CloudFormation Console**:
   - Navigate to: https://console.aws.amazon.com/cloudformation

2. **Create Stack**:
   - Click **Create stack** → **With new resources (standard)**

3. **Upload Template**:
   - Choose **Upload a template file**
   - Select `infrastructure/api-with-lambda.yaml`
   - Click **Next**

4. **Configure Stack**:
   - **Stack name**: `my-analytics-api`
   - **Parameters**:
     - EnvironmentName: `prod`
     - FirehoseStreamName: `YOUR_FIREHOSE_STREAM_NAME`
   - Click **Next**

5. **Configure Options**:
   - Leave defaults
   - Click **Next**

6. **Review**:
   - Check: **"I acknowledge that AWS CloudFormation might create IAM resources"**
   - Click **Submit**

7. **Wait for Completion**:
   - Status will change from `CREATE_IN_PROGRESS` → `CREATE_COMPLETE` (~3 minutes)

8. **Get API Endpoint**:
   - Click **Outputs** tab
   - Copy the **ApiEndpoint** value

## Step 3: Test the API

Test that the pipeline is working:

```bash
cd scripts
./test_api.sh https://YOUR-API-ID.execute-api.us-west-1.amazonaws.com/events
```

Expected output:
```
✅ SUCCESS! Event was sent to Firehose

Response Status: 200
Response Body: {"status": "success", "recordId": "abc123..."}
```

## Step 4: Verify Data in S3

Wait 5-10 minutes for Firehose to flush data to S3, then check:

```bash
# List recent files
aws s3 ls s3://YOUR_BUCKET_NAME/data/ --recursive | tail -20

# Download a file to inspect
aws s3 cp s3://YOUR_BUCKET_NAME/data/year=2024/month=02/day=13/file.json ./test.json

# View contents
cat test.json
```

You should see JSON events like:
```json
{"metricName": "ContentElementInteraction", "timestamp": 1707849600000, ...}
```

## Step 5: Test CSV Conversion

```bash
# Convert the test file to CSV
python3 scripts/json_to_csv.py ./test.json ./test.csv

# View the CSV
head ./test.csv
```

## What Was Deployed?

The CloudFormation stack created:

1. **HTTP API Gateway**
   - Public endpoint for receiving events
   - CORS configured for browser access
   - Throttling: 2000 req/sec

2. **Lambda Function**
   - Name: `prod-analytics-forwarder`
   - Runtime: Python 3.11
   - Forwards events to Firehose
   - Adds server timestamp

3. **IAM Role**
   - Grants Lambda permission to write to Firehose
   - CloudWatch Logs access for debugging

4. **CloudWatch Log Group**
   - Logs Lambda execution
   - Retention: 7 days

## Infrastructure Details

### API Gateway

- **Type**: HTTP API (v2)
- **Protocol**: HTTPS only
- **CORS**: Enabled for all origins
- **Methods**: POST, OPTIONS
- **Path**: `/events`

### Lambda

- **Memory**: 128 MB (default)
- **Timeout**: 30 seconds
- **Runtime**: Python 3.11
- **Handler**: `index.lambda_handler`

### Permissions

Lambda has permission to:
- `firehose:PutRecord` - Send single events
- `firehose:PutRecordBatch` - Send batched events
- `logs:CreateLogGroup` - Create log groups
- `logs:CreateLogStream` - Create log streams
- `logs:PutLogEvents` - Write logs

## Monitoring

### CloudWatch Logs

View Lambda execution logs:
```bash
aws logs tail /aws/lambda/prod-analytics-forwarder --follow --region us-west-1
```

Or via console:
https://console.aws.amazon.com/cloudwatch/home?region=us-west-1#logsV2:log-groups/log-group/$252Faws$252Flambda$252Fprod-analytics-forwarder

### CloudWatch Metrics

Monitor via AWS Console:
- **Lambda**: Invocations, Duration, Errors
- **API Gateway**: Request count, 4xx errors, 5xx errors
- **Firehose**: Records received, delivery to S3

### Alarms (Optional)

Set up CloudWatch Alarms for:
- Lambda errors > threshold
- API Gateway 5xx errors
- Firehose delivery failures

## Updating the Stack

To update the infrastructure:

```bash
aws cloudformation update-stack \
  --stack-name my-analytics-api \
  --template-body file://api-with-lambda.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-west-1
```

## Deleting the Stack

To remove all resources:

```bash
aws cloudformation delete-stack \
  --stack-name my-analytics-api \
  --region us-west-1
```

**Note**: This does NOT delete the S3 bucket or data. You'll need to delete those separately if desired.

## Troubleshooting

### Stack Creation Failed

1. Check CloudFormation Events tab for error message
2. Common issues:
   - IAM permissions - did you check the IAM acknowledgment?
   - Firehose stream name incorrect
   - Resource name conflicts
   - Region mismatch

### API Returns 403

- Check CORS configuration in API Gateway
- Verify endpoint URL is correct (should end with `/events`)

### Events Not Reaching S3

1. Check Lambda logs for errors
2. Verify Firehose stream name is correct
3. Check Firehose IAM permissions
4. Wait 5-10 minutes (Firehose buffers)

### Lambda Timeout

- Check Firehose stream is responding
- Increase Lambda timeout in CloudFormation template
- Check network connectivity

## Security Considerations

### API Gateway

- Currently allows all origins (`*`) for CORS
- Consider restricting to specific domains in production
- Add API keys or authentication if needed

### S3 Bucket

- Enable encryption at rest
- Enable versioning for data protection
- Set up lifecycle policies for old data
- Block public access

### IAM Roles

- Follow principle of least privilege
- Review permissions regularly
- Use AWS IAM Access Analyzer

## Cost Optimization

### API Gateway

- Use HTTP API (not REST API) - much cheaper
- Monitor usage and set up budgets

### Lambda

- Current 128 MB is sufficient
- Monitor execution time
- Consider Reserved Concurrency for predictable workloads

### Firehose

- Optimize buffer settings (5 MB / 300 seconds)
- Enable compression (GZIP)
- Use Parquet format for better compression

### S3

- Enable Intelligent-Tiering
- Set up lifecycle policies:
  - 30 days → Standard-IA
  - 90 days → Glacier
  - 365 days → Delete
- Enable compression in Firehose

## Next Steps

1. ✅ Infrastructure deployed
2. ✅ API tested successfully
3. ✅ Data verified in S3
4. ✅ CSV conversion tested
5. → [Integrate with your app](INTEGRATION.md)
6. → Set up daily CSV exports
7. → Configure monitoring and alarms

## Support

For issues:
- Check [Troubleshooting Guide](TROUBLESHOOTING.md)
- Review CloudWatch Logs
- Check AWS Service Health Dashboard
