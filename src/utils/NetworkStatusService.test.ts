import { describe, expect, it } from 'vitest';
import { NetworkStatusService } from './NetworkStatusService';

describe('NetworkStatusService', () => {
  it('tracks degraded features and errors', () => {
    const service = NetworkStatusService.getInstance();
    service.reset();

    service.markDegraded('vulnerability-scan', 'timeout');
    service.markDegraded('vulnerability-scan', 'another');

    const status = service.getStatus();
    expect(status.isOnline).toBe(false);
    expect(status.degradedFeatures).toContain('vulnerability-scan');
    expect(status.errors.length).toBeLessThanOrEqual(5);
    expect(service.hasIssues()).toBe(true);
  });

  it('builds user-friendly messages', () => {
    const service = NetworkStatusService.getInstance();
    service.reset();

    // No issues -> empty message
    expect(service.getUserMessage()).toBe('');

    service.markDegraded('npm-registry', 'offline');
    const message = service.getUserMessage();
    expect(message.toLowerCase()).toContain('npm registry');
  });

  it('supports simulated offline mode', async () => {
    const service = NetworkStatusService.getInstance();
    service.reset();
    service.setSimulateOffline(true);

    const online = await service.checkConnectivity();
    expect(online).toBe(false);
    expect(service.isSimulatingOffline()).toBe(true);
    service.setSimulateOffline(false);
  });

  it('detects network errors from messages', () => {
    expect(NetworkStatusService.isNetworkError('ENOTFOUND registry.npmjs.org')).toBe(true);
    expect(NetworkStatusService.isNetworkError('No internet connection available')).toBe(true);
    expect(NetworkStatusService.isNetworkError('network mode mismatch')).toBe(false);
    expect(NetworkStatusService.isNetworkError('some random error')).toBe(false);
  });
});
