#!/bin/bash
#
# Test the analytics API endpoint
#
# Usage:
#   ./test_api.sh https://your-api-id.execute-api.us-west-1.amazonaws.com/events
#

set -e

if [ $# -lt 1 ]; then
    echo "Usage: $0 <api-endpoint-url>"
    echo ""
    echo "Example:"
    echo "  $0 https://abc123.execute-api.us-west-1.amazonaws.com/events"
    exit 1
fi

API_ENDPOINT=$1

echo "Testing API endpoint: $API_ENDPOINT"
echo ""

# Test 1: Send a simple event
echo "Test 1: Sending test event..."
RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$API_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{
    "metricName": "ContentElementInteraction",
    "value": 1,
    "demoContentId": "TestEvent-12345",
    "timestamp": '$(date +%s000)',
    "sessionId": "test-session-'$(date +%s)'",
    "device": "test-device",
    "deviceCodename": "test",
    "language": "en_us",
    "metricAttributes": {
      "action": "test",
      "context": "api-test"
    }
  }')

HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_STATUS:")

echo "Response Status: $HTTP_STATUS"
echo "Response Body: $BODY"
echo ""

if [ "$HTTP_STATUS" = "200" ]; then
    echo "✅ SUCCESS! Event was sent to Firehose"
    echo ""
    echo "Next steps:"
    echo "  1. Wait 5-10 minutes for Firehose to flush to S3"
    echo "  2. Check your S3 bucket for new data"
    echo "  3. Configure your app with this endpoint"
else
    echo "❌ FAILED! Status code: $HTTP_STATUS"
    echo ""
    echo "Troubleshooting:"
    echo "  - Check CloudWatch Logs for the Lambda function"
    echo "  - Verify Firehose stream name is correct"
    echo "  - Check IAM permissions"
fi

echo ""
echo "CloudWatch Logs:"
echo "https://us-west-1.console.aws.amazon.com/cloudwatch/home?region=us-west-1#logsV2:log-groups/log-group/\$252Faws\$252Flambda\$252Fprod-analytics-forwarder"
