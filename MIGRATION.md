# Migration from OnDeviceScreenDemo

Guide for integrating amz-analytics with your existing OnDeviceScreenDemo project.

## Overview

The analytics code was extracted from OnDeviceScreenDemo and generalized into a reusable package. This guide helps you integrate it back into your project.

## Quick Integration (5 minutes)

### Step 1: Copy the Analytics Module

```bash
# From the amz-analytics directory
cp src/csvAnalytics.ts /Users/austinhumes/dev/OnDeviceScreenDemo/src/utils/
```

### Step 2: Update Your .env File

Add these to `/Users/austinhumes/dev/OnDeviceScreenDemo/.env`:

```bash
# Get this from CloudFormation Outputs
VITE_ANALYTICS_ENDPOINT=https://YOUR-API-ID.execute-api.us-west-1.amazonaws.com/events
VITE_ENABLE_CSV_ANALYTICS=true

# Optional: customize batching
VITE_ANALYTICS_BATCH_SIZE=25
VITE_ANALYTICS_BATCH_TIMEOUT=30000
```

### Step 3: Initialize Analytics

Edit `/Users/austinhumes/dev/OnDeviceScreenDemo/src/main.tsx` (or `App.tsx`):

```typescript
import { initializeAnalytics } from './utils/csvAnalytics';

// Add this BEFORE ReactDOM.render or app initialization
initializeAnalytics({
  endpoint: import.meta.env.VITE_ANALYTICS_ENDPOINT,
  enabled: import.meta.env.VITE_ENABLE_CSV_ANALYTICS === 'true',
});

// Rest of your app initialization...
```

### Step 4: Integrate with Existing emitMetric

Edit `/Users/austinhumes/dev/OnDeviceScreenDemo/src/types/DemoInterface.ts`:

```typescript
// Add import at the top
import { trackEvent } from '../utils/csvAnalytics';

// In the emitMetric function, add ONE line at the end:
export function emitMetric(
  name: metricName,
  value?: number,
  demoContentId?: string,
  metricAttributes?: string,
  demoExperimentGroup?: string
) {
  // ... ALL existing code stays the same ...

  callDemoInterface(
    'emitMetric',
    name,
    value,
    finalContentId,
    finalAttributes,
    demoExperimentGroup
  );

  // 👇 ADD THIS ONE LINE - sends to your analytics
  trackEvent(name, value, finalContentId, finalAttributes, demoExperimentGroup);
}
```

**That's it!** Now every call to `emitMetric` will:
1. Send to the original DemoInterface (unchanged)
2. ALSO send to your new analytics pipeline

## What This Does

### Dual Tracking
- **Original**: Events still go to wrapper app via DemoInterface
- **New**: Same events also go to your S3 via API Gateway

### No Breaking Changes
- Existing `emitMetric` calls work exactly the same
- No changes needed to any components
- No changes to metric names or attributes
- Can be disabled via `.env` without code changes

### Data Format
The CSV output will have all the same fields you're currently sending:
- `metricName` (ContentElementInteraction, ContentPlayDuration, etc.)
- `demoContentId` (the event identifier with UUID/device)
- All `metricAttributes` flattened as `attr_*` columns
- Device context (device, deviceCodename, language, etc.)
- Additional fields: `sessionId`, `serverTimestamp`

## Testing

### 1. Build and Run
```bash
cd /Users/austinhumes/dev/OnDeviceScreenDemo
npm run dev
```

### 2. Check Browser Console
Open DevTools → Console, look for:
```
[CSV Analytics] Event queued (1/25)
[CSV Analytics] Batch sent successfully (25 events)
```

### 3. Check Network Tab
Filter for your API endpoint, verify:
- POST requests are being sent
- Status code is 200
- Response includes `recordId`

### 4. Verify in S3 (after 5-10 minutes)
```bash
# List recent files
aws s3 ls s3://YOUR_BUCKET/data/ --recursive | tail -20

# Download and inspect
aws s3 cp s3://YOUR_BUCKET/data/year=2024/month=02/day=13/latest.json ./
cat latest.json | jq '.'
```

## Comparison: Before vs After

### Before
```
OnDeviceScreenDemo App
  └─ emitMetric()
      └─ DemoInterface (wrapper app)
          └─ Wrapper app's data store
```

### After
```
OnDeviceScreenDemo App
  └─ emitMetric()
      ├─ DemoInterface (wrapper app) ← Still works
      │   └─ Wrapper app's data store
      │
      └─ trackEvent() (new) ← Added
          └─ API Gateway
              └─ Lambda
                  └─ Firehose
                      └─ Your S3 bucket (CSV-ready)
```

## Environment-Specific Configuration

### Development (Local)
```bash
# .env.development
VITE_ANALYTICS_ENDPOINT=https://dev-api.execute-api.us-west-1.amazonaws.com/events
VITE_ENABLE_CSV_ANALYTICS=true
VITE_ANALYTICS_BATCH_SIZE=10  # Smaller batches for testing
```

### Production (Device)
```bash
# .env.production
VITE_ANALYTICS_ENDPOINT=https://prod-api.execute-api.us-west-1.amazonaws.com/events
VITE_ENABLE_CSV_ANALYTICS=true
VITE_ANALYTICS_BATCH_SIZE=50  # Larger batches for efficiency
```

### Disable Analytics
```bash
# To disable without changing code
VITE_ENABLE_CSV_ANALYTICS=false
```

## Data Schema Mapping

Your existing metrics map directly:

| Current Field | CSV Column | Notes |
|--------------|------------|-------|
| metricName | `metricName` | Same values |
| value | `value` | Same (optional numeric) |
| demoContentId | `demoContentId` | Includes device/UUID |
| metricAttributes | `attr_*` | Flattened to columns |
| device | `device` | Preserved |
| deviceCodename | `deviceCodename` | Preserved |
| language | `language` | Preserved |
| connected | `connected` | Preserved (non-Vega) |
| banyan | `banyan` | Preserved (non-Vega) |
| simplified | `simplified` | Preserved (non-Vega) |
| gitCommitSha | `gitCommitSha` | Preserved |
| - | `sessionId` | New: unique per session |
| - | `serverTimestamp` | New: server-side timestamp |

## Example Event Flow

### Original Code (Unchanged)
```typescript
// In Button.tsx
emitMetric(
  metricName.ContentElementInteraction,
  undefined,
  'NavigationButtonTapped-b46112db-14ed-464d-9dee-cd5887b271c8',
  JSON.stringify({ action: 'navigation', to: '/discover', context: 'main-menu' })
);
```

### What Happens Now
1. ✅ Sent to DemoInterface (as before)
2. ✅ Sent to trackEvent (new)
   - Batched with other events
   - Sent to API Gateway after 25 events or 30 seconds
   - Forwarded to Firehose
   - Written to S3
   - Ready for CSV export

### CSV Output
```csv
timestamp,sessionId,metricName,demoContentId,device,deviceCodename,language,attr_action,attr_to,attr_context,serverTimestamp
1707849600000,abc123,ContentElementInteraction,NavigationButtonTapped-...,echo-show-8,cypress,en_us,navigation,/discover,main-menu,2024-02-13T10:00:00Z
```

## Rollback Plan

If you need to disable or remove the analytics:

### Quick Disable (No Code Changes)
```bash
# In .env
VITE_ENABLE_CSV_ANALYTICS=false
```

### Complete Removal
1. Remove the `trackEvent()` call from `emitMetric()`
2. Remove the `initializeAnalytics()` call from `main.tsx`
3. Delete `src/utils/csvAnalytics.ts`
4. Remove env variables from `.env`

Everything else continues to work normally.

## Performance Impact

### Minimal Overhead
- **Batching**: Only 1 API call per 25 events (default)
- **Async**: Network calls don't block UI
- **Lightweight**: ~5KB added to bundle size

### Monitoring
Check browser DevTools Performance tab:
- API calls should be negligible
- No UI blocking
- Batching reduces network overhead

## FAQ

### Q: Will this affect existing analytics?
**A**: No, the original DemoInterface calls are unchanged.

### Q: What if the API is down?
**A**: Events are queued and retried (3 attempts with backoff). If all retries fail, events are dropped but app continues normally.

### Q: Can I use this in production?
**A**: Yes! It's designed for production use. Consider:
- Add API authentication if needed
- Monitor CloudWatch for errors
- Set up alarms for failures

### Q: How do I debug issues?
**A**: Check:
1. Browser console for batch logs
2. Network tab for API calls
3. CloudWatch logs for Lambda errors
4. Firehose monitoring for delivery status

### Q: Can I customize the data format?
**A**: Yes! Edit `csvAnalytics.ts`:
- Add custom fields in the event object
- Modify batching behavior
- Add data transformations

## Next Steps

1. ✅ Copy csvAnalytics.ts to your project
2. ✅ Add environment variables
3. ✅ Initialize analytics at app startup
4. ✅ Add trackEvent() to emitMetric()
5. ✅ Test in development
6. ✅ Verify data appears in S3
7. ✅ Download and convert to CSV
8. ✅ Import into your existing analytics tool
9. ✅ Deploy to production devices

## Support

If you run into issues:
- Check the [Troubleshooting Guide](docs/TROUBLESHOOTING.md)
- Review CloudWatch logs
- Test the API with `scripts/test_api.sh`
- Verify Firehose configuration
