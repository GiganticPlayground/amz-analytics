/**
 * AMZ Analytics Module
 *
 * A standalone analytics module that batches events and sends them to AWS Kinesis
 * Firehose for CSV storage in S3.
 *
 * This module is framework-agnostic and can be integrated into any JavaScript/TypeScript
 * application. It handles batching, retries, and reliable delivery of analytics events.
 */

/**
 * Standard metric types
 * Extend this enum to add custom metric types for your application
 */
export enum MetricName {
  ContentElementInteraction = 'ContentElementInteraction',
  ContentPlayDuration = 'ContentPlayDuration',
  ContentPageLoad = 'ContentPageLoad',
  ContentSectionLoad = 'ContentSectionLoad',
  CustomerSatisfaction = 'CustomerSatisfaction',
  // Add your custom metric types here
}

/**
 * Device/application context that will be included with every event
 * Customize this to match your application's context
 */
export interface DeviceContext {
  device?: string;
  deviceCodename?: string;
  language?: string;
  connected?: boolean;
  gitCommitSha?: string;
  gitBranch?: string;
  appVersion?: string;
  // Add your custom context fields here
  [key: string]: any;
}

export interface AnalyticsEvent {
  timestamp: number;
  metricName: string;
  value?: number;
  contentId?: string;
  attributes?: Record<string, any>;
  experimentGroup?: string;
  // Session metadata
  sessionId: string;
  userAgent: string;
  // Device/app context (merged from config)
  [key: string]: any;
}

export interface AnalyticsConfig {
  endpoint: string;
  enabled?: boolean;
  batchSize?: number;
  batchTimeout?: number;
  maxRetries?: number;
  // Optional: Add device/app context that will be included with every event
  context?: DeviceContext;
}

class Analytics {
  private config: Required<Omit<AnalyticsConfig, 'context'>> & { context: DeviceContext };
  private eventQueue: AnalyticsEvent[] = [];
  private sessionId: string;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isFlushingInProgress = false;
  private failedBatches: AnalyticsEvent[][] = [];

  constructor(config: AnalyticsConfig) {
    this.config = {
      endpoint: config.endpoint,
      enabled: config.enabled ?? true,
      batchSize: config.batchSize ?? 25,
      batchTimeout: config.batchTimeout ?? 30000, // 30 seconds
      maxRetries: config.maxRetries ?? 3,
      context: config.context ?? {},
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
   * Track an analytics event
   */
  public trackEvent(
    metricName: string,
    value?: number,
    contentId?: string,
    attributes?: string | Record<string, any>,
    experimentGroup?: string
  ): void {
    if (!this.config.enabled) {
      return;
    }

    try {
      // Parse attributes if it's a string
      let parsedAttributes: Record<string, any> = {};
      if (attributes) {
        if (typeof attributes === 'string') {
          try {
            parsedAttributes = JSON.parse(attributes);
          } catch (e) {
            console.warn('[AMZ Analytics] Failed to parse attributes:', e);
            parsedAttributes = { raw: attributes };
          }
        } else {
          parsedAttributes = attributes;
        }
      }

      // Create the event object with all context
      const event: AnalyticsEvent = {
        timestamp: Date.now(),
        metricName,
        value,
        contentId,
        attributes: parsedAttributes,
        experimentGroup,
        // Session metadata
        sessionId: this.sessionId,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        // Merge in device/app context from config
        ...this.config.context,
      };

      // Add to queue
      this.eventQueue.push(event);
      console.log(`[AMZ Analytics] Event queued (${this.eventQueue.length}/${this.config.batchSize})`);

      // Flush if we've reached the batch size
      if (this.eventQueue.length >= this.config.batchSize) {
        this.flush();
      }
    } catch (error) {
      console.error('[AMZ Analytics] Error tracking event:', error);
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
    }, this.config.batchTimeout);
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
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.flush();
        }
      });
    }
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
      const sent = navigator.sendBeacon(this.config.endpoint, blob);

      if (!sent) {
        console.warn('[AMZ Analytics] Failed to send beacon with batch of', batch.length, 'events');
      }
    } else {
      // Fallback: Try synchronous XHR (not recommended but better than nothing)
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', this.config.endpoint, false); // false = synchronous
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify(batch));
      } catch (error) {
        console.error('[AMZ Analytics] Failed to send events synchronously:', error);
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
   * Send a batch of events to the analytics endpoint
   */
  private async sendBatch(batch: AnalyticsEvent[], retryCount = 0): Promise<void> {
    try {
      const response = await fetch(this.config.endpoint, {
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

      console.log(`[AMZ Analytics] Batch sent successfully (${batch.length} events)`);
    } catch (error) {
      console.error('[AMZ Analytics] Failed to send batch:', error);

      // Retry logic
      if (retryCount < this.config.maxRetries) {
        console.log(`[AMZ Analytics] Retrying (attempt ${retryCount + 1}/${this.config.maxRetries})`);

        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, retryCount) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));

        return this.sendBatch(batch, retryCount + 1);
      } else {
        // Store failed batch for later retry or debugging
        this.failedBatches.push(batch);
        console.warn(
          `[AMZ Analytics] Failed after ${this.config.maxRetries} retries. ${batch.length} events lost.`
        );
      }
    }
  }

  /**
   * Get failed batches for debugging or manual retry
   */
  public getFailedBatches(): AnalyticsEvent[][] {
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

  /**
   * Get the session ID
   */
  public getSessionId(): string {
    return this.sessionId;
  }
}

// Singleton instance
let analyticsInstance: Analytics | null = null;

/**
 * Initialize the analytics module
 * Must be called before using trackEvent
 *
 * @example
 * ```typescript
 * initializeAnalytics({
 *   endpoint: 'https://your-api.execute-api.us-west-1.amazonaws.com/events',
 *   enabled: true,
 *   batchSize: 25,
 *   batchTimeout: 30000,
 *   context: {
 *     device: 'echo-show-8',
 *     deviceCodename: 'cypress',
 *     language: 'en_us',
 *     appVersion: '1.0.0',
 *     gitCommitSha: 'abc123',
 *   }
 * });
 * ```
 */
export function initializeAnalytics(config: AnalyticsConfig): Analytics {
  if (analyticsInstance) {
    console.log('[AMZ Analytics] Destroying existing instance');
    analyticsInstance.destroy();
  }

  console.log('[AMZ Analytics] Initializing with endpoint:', config.endpoint);
  analyticsInstance = new Analytics(config);
  return analyticsInstance;
}

/**
 * Get the current analytics instance
 */
export function getAnalyticsInstance(): Analytics | null {
  return analyticsInstance;
}

/**
 * Track an analytics event
 * This is a convenience wrapper that uses the singleton instance
 *
 * @example
 * ```typescript
 * trackEvent(
 *   'ContentElementInteraction',
 *   undefined,
 *   'ButtonClicked-123',
 *   JSON.stringify({ action: 'click', button: 'submit' })
 * );
 * ```
 */
export function trackEvent(
  metricName: string,
  value?: number,
  contentId?: string,
  attributes?: string | Record<string, any>,
  experimentGroup?: string
): void {
  if (!analyticsInstance) {
    console.warn('[AMZ Analytics] Not initialized. Call initializeAnalytics() first.');
    return;
  }

  analyticsInstance.trackEvent(metricName, value, contentId, attributes, experimentGroup);
}

/**
 * Manually flush all pending events
 */
export async function flushEvents(): Promise<void> {
  if (analyticsInstance) {
    await analyticsInstance.flush();
  }
}

/**
 * Get the current session ID
 */
export function getSessionId(): string | null {
  return analyticsInstance?.getSessionId() ?? null;
}

/**
 * Get the number of queued events
 */
export function getQueueSize(): number {
  return analyticsInstance?.getQueueSize() ?? 0;
}

