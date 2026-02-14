/**
 * CSV Analytics Module
 *
 * Provides a wrapper around the existing emitMetric function that batches events
 * and sends them to AWS Kinesis Firehose for CSV storage in S3.
 *
 * This module works alongside the native emitMetric function, not as a replacement.
 * Events are batched for efficiency and sent to Firehose, then formatted as CSV
 * on the server side.
 */

import { metricName } from '../types/DemoInterface';
import {
  device,
  deviceCodename,
  lang,
  connected,
  banyan,
  simplified,
  retailer,
  gitCommitSha,
  gitBranch,
  isVegaPlatform,
} from '../utils';

interface CSVMetricEvent {
  timestamp: string;
  metricName: string;
  value?: number;
  demoContentId?: string;
  metricAttributes?: Record<string, unknown>;
  demoExperimentGroup?: string;
  // Device context fields
  device: string;
  deviceCodename: string;
  language: string;
  connected: boolean;
  banyan: boolean;
  simplified: boolean;
  retailer: string;
  gitCommitSha: string;
  gitBranch: string;
  isVegaPlatform: boolean;
  // Additional metadata
  sessionId: string;
  userAgent: string;
}

interface CSVAnalyticsConfig {
  firehoseUrl: string;
  batchSize?: number;
  flushInterval?: number;
  maxRetries?: number;
  enabled?: boolean;
}

class CSVAnalytics {
  private config: Required<CSVAnalyticsConfig>;
  private eventQueue: CSVMetricEvent[] = [];
  private sessionId: string;
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushingInProgress = false;
  private failedBatches: CSVMetricEvent[][] = [];

  constructor(config: CSVAnalyticsConfig) {
    this.config = {
      batchSize: config.batchSize ?? 25,
      flushInterval: config.flushInterval ?? 30000, // 30 seconds
      maxRetries: config.maxRetries ?? 3,
      enabled: config.enabled ?? true,
      firehoseUrl: config.firehoseUrl,
    };

    // Generate a unique session ID for this page load
    this.sessionId = this.generateSessionId();

    // Set up automatic flushing
    if (this.config.enabled) {
      this.startFlushTimer();
      this.setupUnloadHandler();
    }
  }

  /**
   * Generate a unique session ID for tracking events across a single page session
   */
  private generateSessionId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 11);
    return `${timestamp}-${random}`;
  }

  /**
   * Emit a metric event that will be batched and sent to Kinesis Firehose
   */
  public emitMetric(
    name: metricName,
    value?: number,
    demoContentId?: string,
    metricAttributes?: string,
    demoExperimentGroup?: string
  ): void {
    if (!this.config.enabled) {
      return;
    }

    try {
      // Parse metric attributes if provided
      let parsedAttributes: Record<string, unknown> = {};
      if (metricAttributes) {
        try {
          parsedAttributes = JSON.parse(metricAttributes);
        } catch (e) {
          console.warn('Failed to parse metricAttributes:', e);
          parsedAttributes = { raw: metricAttributes };
        }
      }

      // Create the event object with all context
      const event: CSVMetricEvent = {
        timestamp: new Date().toISOString(),
        metricName: name,
        value,
        demoContentId,
        metricAttributes: parsedAttributes,
        demoExperimentGroup,
        // Device context
        device,
        deviceCodename,
        language: lang,
        connected,
        banyan,
        simplified,
        retailer,
        gitCommitSha,
        gitBranch,
        isVegaPlatform,
        // Session metadata
        sessionId: this.sessionId,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      };

      // Add to queue
      this.eventQueue.push(event);

      // Flush if we've reached the batch size
      if (this.eventQueue.length >= this.config.batchSize) {
        this.flush();
      }
    } catch (error) {
      console.error('Error emitting CSV metric:', error);
    }
  }

  /**
   * Start the automatic flush timer
   */
  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      if (this.eventQueue.length > 0) {
        this.flush();
      }
    }, this.config.flushInterval);
  }

  /**
   * Set up handler to flush events before page unload
   */
  private setupUnloadHandler(): void {
    if (typeof window === 'undefined') {
      return;
    }

    // Use pagehide for better mobile support
    window.addEventListener('pagehide', () => {
      this.flushSync();
    });

    // Fallback to beforeunload
    window.addEventListener('beforeunload', () => {
      this.flushSync();
    });

    // Also handle visibility change (when tab is hidden)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.flush();
      }
    });
  }

  /**
   * Flush events synchronously using sendBeacon for page unload scenarios
   */
  private flushSync(): void {
    if (this.eventQueue.length === 0) {
      return;
    }

    const batch = [...this.eventQueue];
    this.eventQueue = [];

    // Use sendBeacon for reliable delivery during page unload
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const payload = JSON.stringify(batch);
      const blob = new Blob([payload], { type: 'application/json' });
      const sent = navigator.sendBeacon(this.config.firehoseUrl, blob);

      if (!sent) {
        console.warn('Failed to send beacon with batch of', batch.length, 'events');
      }
    } else {
      // Fallback: Try synchronous XHR (not recommended but better than nothing)
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', this.config.firehoseUrl, false); // false = synchronous
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify(batch));
      } catch (error) {
        console.error('Failed to send events synchronously:', error);
      }
    }
  }

  /**
   * Flush events asynchronously
   */
  public async flush(): Promise<void> {
    if (this.eventQueue.length === 0 || this.isFlushingInProgress) {
      return;
    }

    this.isFlushingInProgress = true;

    try {
      const batch = [...this.eventQueue];
      this.eventQueue = [];

      await this.sendBatch(batch);
    } finally {
      this.isFlushingInProgress = false;
    }
  }

  /**
   * Send a batch of events to Kinesis Firehose
   */
  private async sendBatch(batch: CSVMetricEvent[], retryCount = 0): Promise<void> {
    try {
      const response = await fetch(this.config.firehoseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch),
        // Use keepalive for better reliability
        keepalive: true,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      console.log(`Successfully sent batch of ${batch.length} events to Firehose`);
    } catch (error) {
      console.error('Failed to send batch to Firehose:', error);

      // Retry logic
      if (retryCount < this.config.maxRetries) {
        console.log(`Retrying batch send (attempt ${retryCount + 1}/${this.config.maxRetries})`);

        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, retryCount) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));

        return this.sendBatch(batch, retryCount + 1);
      } else {
        // Store failed batch for later retry or debugging
        this.failedBatches.push(batch);
        console.warn(`Failed to send batch after ${this.config.maxRetries} retries. Stored for debugging.`);
      }
    }
  }

  /**
   * Get failed batches for debugging or manual retry
   */
  public getFailedBatches(): CSVMetricEvent[][] {
    return this.failedBatches;
  }

  /**
   * Retry all failed batches
   */
  public async retryFailedBatches(): Promise<void> {
    const batches = [...this.failedBatches];
    this.failedBatches = [];

    for (const batch of batches) {
      await this.sendBatch(batch);
    }
  }

  /**
   * Clear all queued events
   */
  public clear(): void {
    this.eventQueue = [];
    this.failedBatches = [];
  }

  /**
   * Destroy the analytics instance and clean up resources
   */
  public destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  /**
   * Get current queue size
   */
  public getQueueSize(): number {
    return this.eventQueue.length;
  }
}

// Singleton instance
let analyticsInstance: CSVAnalytics | null = null;

/**
 * Initialize the CSV analytics module
 * Must be called before using emitCSVMetric
 */
export function initCSVAnalytics(config: CSVAnalyticsConfig): CSVAnalytics {
  if (analyticsInstance) {
    analyticsInstance.destroy();
  }

  analyticsInstance = new CSVAnalytics(config);
  return analyticsInstance;
}

/**
 * Get the current analytics instance
 */
export function getCSVAnalytics(): CSVAnalytics | null {
  return analyticsInstance;
}

/**
 * Emit a metric event to CSV analytics
 * This is a convenience wrapper that uses the singleton instance
 */
export function emitCSVMetric(
  name: metricName,
  value?: number,
  demoContentId?: string,
  metricAttributes?: string,
  demoExperimentGroup?: string
): void {
  if (!analyticsInstance) {
    console.warn('CSV Analytics not initialized. Call initCSVAnalytics() first.');
    return;
  }

  analyticsInstance.emitMetric(name, value, demoContentId, metricAttributes, demoExperimentGroup);
}

/**
 * Manually flush all pending events
 */
export async function flushCSVMetrics(): Promise<void> {
  if (analyticsInstance) {
    await analyticsInstance.flush();
  }
}

// Export types
export type { CSVMetricEvent, CSVAnalyticsConfig };
