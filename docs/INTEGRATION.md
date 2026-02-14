# App Integration Quickstart

Your analytics pipeline is now live! Here's how to integrate it with your OnDeviceScreenDemo app.

## ✅ What's Working

- API Gateway: Receiving requests
- Lambda: Forwarding to Firehose
- Firehose: Writing to S3
- S3: Storing JSON events
- CSV Converter: Tested and working

## 🚀 Quick Setup (5 minutes)

### Step 1: Add Environment Variable

Create or update `/Users/austinhumes/dev/OnDeviceScreenDemo/.env`:

```bash
# Analytics Configuration
VITE_ANALYTICS_ENDPOINT=YOUR_API_ENDPOINT_HERE
VITE_ENABLE_CSV_ANALYTICS=true

# Optional: Batch settings
VITE_ANALYTICS_BATCH_SIZE=25
VITE_ANALYTICS_BATCH_TIMEOUT=30000
```

**Replace `YOUR_API_ENDPOINT_HERE`** with your actual endpoint from CloudFormation Outputs.

Example:
```bash
VITE_ANALYTICS_ENDPOINT=https://abc123xyz.execute-api.us-west-1.amazonaws.com/events
```

### Step 2: Initialize Analytics

**Option A: Minimal Integration (Recommended)**

Edit `src/types/DemoInterface.ts` and add one line:

```typescript
import { trackEvent } from '../utils/csvAnalytics';

export function emitMetric(
  name: metricName,
  value?: number,
  demoContentId?: string,
  metricAttributes?: string,
  demoExperimentGroup?: string
) {
  // ... existing code ...

  callDemoInterface(
    'emitMetric',
    name,
    value,
    finalContentId,
    finalAttributes,
    demoExperimentGroup
  );

  // 👇 ADD THIS LINE - sends to your analytics
  trackEvent(name, value, finalContentId, finalAttributes, demoExperimentGroup);
}
```

Then initialize at app startup in `src/main.tsx` or `src/App.tsx`:

```typescript
import { initializeAnalytics } from './utils/csvAnalytics';

// At the top of your file, before rendering
initializeAnalytics({
  endpoint: import.meta.env.VITE_ANALYTICS_ENDPOINT,
  enabled: import.meta.env.VITE_ENABLE_CSV_ANALYTICS === 'true',
});
```

**Option B: Side-by-side (Test First)**

If you want to test without modifying `emitMetric`, manually call `trackEvent` in a few places:

```typescript
import { trackEvent, metricName } from './utils/csvAnalytics';

// In a button click handler
const handleClick = () => {
  trackEvent(
    metricName.ContentElementInteraction,
    undefined,
    'TestButton-clicked',
    JSON.stringify({ action: 'click', component: 'TestButton' })
  );
};
```

### Step 3: Build and Test

```bash
# Install dependencies (if needed)
npm install

# Run dev server
npm run dev

# Or build and preview
npm run build
npm run preview
```

### Step 4: Verify Events

1. **Open browser DevTools** → Console
2. **Interact with the app** (click buttons, navigate, etc.)
3. **Look for log messages**:
   ```
   [CSV Analytics] Event queued (1/25)
   [CSV Analytics] Batch sent successfully (25 events)
   ```

4. **Check Network tab** → Filter for your API endpoint
   - Should see POST requests with 200 status

### Step 5: Check S3 (After 5-10 minutes)

Wait for Firehose to flush (5-10 minutes), then check S3:

```bash
# Check what bucket your Firehose is using
# Go to: Firehose Console → AH_TEST_EFD_ANALYTICS → Destination

# List recent files
aws s3 ls s3://YOUR_BUCKET_NAME/data/ --recursive | tail -20
```

Or via AWS Console:
1. Go to S3 Console
2. Navigate to your bucket
3. Browse to `data/year=YYYY/month=MM/day=DD/`
4. Download latest file
5. Verify it contains events from your app

## 📊 Daily CSV Export

Once you have data flowing, use the automated script to get daily CSV files:

```bash
# Download and convert data for a specific date
./scripts/download_and_convert.sh 2024-02-13 YOUR_BUCKET_NAME

# Output: analytics_data/csv/2024-02-13_combined.csv
```

This CSV is ready to import into your existing analytics tool!

## 🔍 Troubleshooting

### Events not appearing in S3

1. **Check Browser Console** for errors
2. **Check Network Tab** - Are POST requests successful (200)?
3. **Check Lambda Logs**:
   ```
   https://us-west-1.console.aws.amazon.com/cloudwatch/home?region=us-west-1#logsV2:log-groups/log-group/$252Faws$252Flambda$252Fprod-analytics-forwarder
   ```
4. **Check Firehose Monitoring** - Any errors?
5. **Wait 10 minutes** - Firehose buffers before writing

### CORS errors in browser

Check that `.env` has the correct endpoint URL (should end with `/events`)

### Events missing fields

Check that `initializeAnalytics()` is called BEFORE any events are sent.

## 📋 CSV Field Reference

Your CSV files will have these columns:

| Column | Description | Example |
|--------|-------------|---------|
| `timestamp` | Client timestamp (ms) | `1707849600000` |
| `serverTimestamp` | Server timestamp (ISO) | `2024-02-13T10:30:00Z` |
| `sessionId` | Unique session ID | `abc123-xyz789` |
| `metricName` | Event type | `ContentElementInteraction` |
| `value` | Numeric value (optional) | `42` |
| `demoContentId` | Event identifier | `NavigationButtonTapped-...` |
| `device` | Device model | `echo-show-8-cypress` |
| `deviceCodename` | Device code | `cypress` |
| `language` | Language code | `en_us` |
| `attr_*` | Flattened attributes | `attr_action`, `attr_to`, etc. |

## 🎯 What's Next?

1. ✅ Verify events flowing to S3
2. ✅ Download first CSV file
3. ✅ Import into your existing analytics tool
4. ✅ Set up daily/weekly exports
5. 📈 Start analyzing!

## 💰 Cost Estimate

For **10 million events/month**:
- API Gateway: ~$10
- Lambda: ~$5 (very cheap)
- Firehose: ~$0.06
- S3 Storage: ~$0.05

**Total: ~$15-20/month** ✨

---

Need help? Check:
- Full setup guide: `docs/SETUP_WITH_EXISTING_FIREHOSE.md`
- Test the API: `./scripts/test_api.sh YOUR_ENDPOINT`
- Convert to CSV: `python3 scripts/json_to_csv.py input.json output.csv`
