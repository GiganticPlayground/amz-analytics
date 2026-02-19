#!/bin/bash
#
# Update the CloudFormation stack with the latest template
#

set -e

STACK_NAME="cds-analytics-api"
REGION="us-west-1"
TEMPLATE_FILE="../infrastructure/api-with-lambda.yaml"

echo "Updating CloudFormation stack: $STACK_NAME"
echo "Region: $REGION"
echo ""

# Note: This assumes AWS CLI is available
# If not, use the AWS Console method instead

echo "Deploying update..."
aws cloudformation update-stack \
  --stack-name "$STACK_NAME" \
  --template-body "file://$TEMPLATE_FILE" \
  --capabilities CAPABILITY_NAMED_IAM \
  --region "$REGION"

echo ""
echo "✅ Update initiated!"
echo ""
echo "The Lambda function will be updated to handle batched events."
echo ""
echo "Monitor progress:"
echo "  aws cloudformation describe-stack-events --stack-name $STACK_NAME --region $REGION --max-items 10"
echo ""
echo "Or view in console:"
echo "  https://us-west-1.console.aws.amazon.com/cloudformation"
echo ""
echo "Once complete (2-3 minutes), test your app again!"
