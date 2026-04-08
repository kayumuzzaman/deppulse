/**
 * NetworkStatusService - Tracks network connectivity state for DepPulse
 *
 * This service monitors network errors from API calls and provides
 * a simple API to check online/offline status for the dashboard.
 */

import axios from 'axios';

export interface NetworkStatus {
  isOnline: boolean;
  degradedFeatures: string[];
  errors: string[];
  lastChecked?: Date;
}

/**
 * Singleton service to track network connectivity state
 */
export class NetworkStatusService {
  private static instance: NetworkStatusService;
  private status: NetworkStatus = {
    isOnline: true,
    degradedFeatures: [],
    errors: [],
  };

  // Development-only: simulate offline mode for testing
  private _simulateOffline = false;

  private constructor() {}

  /**
   * Get the singleton instance
   */
  public static getInstance(): NetworkStatusService {
    if (!NetworkStatusService.instance) {
      NetworkStatusService.instance = new NetworkStatusService();
    }
    return NetworkStatusService.instance;
  }

  /**
   * Reset for a new analysis run
   */
  public reset(): void {
    this.status = {
      isOnline: true,
      degradedFeatures: [],
      errors: [],
      lastChecked: new Date(),
    };
  }

  /**
   * Mark a feature as degraded due to network error
   * @param feature The feature that failed (e.g., 'vulnerability-scan', 'version-check')
   * @param error The error message
   */
  public markDegraded(feature: string, error: string): void {
    this.status.isOnline = false;
    if (!this.status.degradedFeatures.includes(feature)) {
      this.status.degradedFeatures.push(feature);
    }
    // Keep only the last 5 errors to avoid memory bloat
    if (this.status.errors.length < 5) {
      this.status.errors.push(error);
    }
    this.status.lastChecked = new Date();
  }

  /**
   * Mark a successful network request (helps track partial connectivity)
   */
  public markSuccess(): void {
    this.status.lastChecked = new Date();
    // Don't reset isOnline to true here - if any feature failed, we're still degraded
  }

  /**
   * Get the current network status
   */
  public getStatus(): NetworkStatus {
    return { ...this.status };
  }

  /**
   * Check if we have any network issues
   */
  public hasIssues(): boolean {
    return !this.status.isOnline || this.status.degradedFeatures.length > 0;
  }

  /**
   * Get a user-friendly message describing the network status
   */
  public getUserMessage(): string {
    if (this.status.isOnline && this.status.degradedFeatures.length === 0) {
      return '';
    }

    const features = this.status.degradedFeatures;
    if (features.length === 0) {
      return 'Unable to reach external services.';
    }

    const featureNames: Record<string, string> = {
      'vulnerability-scan': 'Vulnerability scanning',
      'version-check': 'Version checking',
      'npm-registry': 'NPM registry',
      'github-advisory': 'GitHub Advisory',
      osv: 'OSV vulnerability database',
    };

    const readableFeatures = features.map((f) => featureNames[f] || f);

    if (readableFeatures.length === 1) {
      return `${readableFeatures[0]} is unavailable due to network issues.`;
    }

    return `${readableFeatures.slice(0, -1).join(', ')} and ${readableFeatures.slice(-1)} are unavailable due to network issues.`;
  }

  /**
   * [Development Only] Set simulated offline mode for testing
   * @param offline Whether to simulate offline mode
   */
  public setSimulateOffline(offline: boolean): void {
    this._simulateOffline = offline;
  }

  /**
   * [Development Only] Check if offline simulation is active
   */
  public isSimulatingOffline(): boolean {
    return this._simulateOffline;
  }

  /**
   * Check if we can reach the npm registry (quick connectivity test)
   * Used to detect offline state before starting a scan
   * @returns true if online, false if offline
   */
  public async checkConnectivity(): Promise<boolean> {
    if (this._simulateOffline) {
      this.markDegraded('npm-registry', 'Simulated offline mode (development)');
      return false;
    }

    try {
      await axios.head('https://registry.npmjs.org/', {
        timeout: 5000,
        headers: { 'User-Agent': 'DepPulse-VSCode-Extension' },
      });
      return true;
    } catch (error: unknown) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? (error as { code: string }).code
          : undefined;

      if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
        this.markDegraded('npm-registry', 'Connection to NPM registry timed out');
      } else {
        this.markDegraded('npm-registry', 'Unable to reach NPM registry');
      }
      return false;
    }
  }

  /**
   * Check if error is a network-related error
   * @param error The error to check
   * @returns true if the error is network-related
   */
  public static isNetworkError(error: unknown): boolean {
    if (!error) return false;

    const errorMessage = String(error).toLowerCase();
    const networkErrorPatterns = [
      /\benotfound\b/,
      /\betimedout\b/,
      /\beconnrefused\b/,
      /\beconnreset\b/,
      /\beai_again\b/,
      /\benetunreach\b/,
      /\behostunreach\b/,
      /getaddrinfo/,
      /\boffline\b/,
      /no internet/,
      /internet connection/,
      /network error/,
      /network request failed/,
      /socket hang up/,
    ];

    return networkErrorPatterns.some((pattern) => pattern.test(errorMessage));
  }
}
