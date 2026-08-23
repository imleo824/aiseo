import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fileTenantRepository } from '../server/infrastructure/persistence/fileTenantRepository';
import * as fs from 'fs';

// Mock fs to avoid writing to real disk during tests
vi.mock('fs');

describe('TenantStore (FileTenantRepository)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return default data for tenant-a', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

    const data = fileTenantRepository.getTenantData('tenant-a');
    expect(data).toBeDefined();
    expect(data.sites).toBeDefined();
    expect(data.sites.length).toBeGreaterThan(0);
    expect(data.sites[0].domain).toBeDefined();
  });

  it('should return empty data for unknown tenant', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

    const data = fileTenantRepository.getTenantData('unknown-tenant');
    expect(data).toBeDefined();
    expect(data.sites).toEqual([]);
    expect(data.automatedTasks).toEqual([]);
  });

  it('should save data correctly', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

    const data = fileTenantRepository.getTenantData('tenant-b');
    const newData = { 
      ...data, 
      automatedTasks: [{ 
        id: '1', 
        siteId: 'site-1', 
        siteName: 'Test Site', 
        taskName: 'Task 1', 
        scheduleType: 'DAILY' as const, 
        scheduleTime: '09:00', 
        targetKeywordTopic: 'Test', 
        articleCountPerRun: 1, 
        status: 'ACTIVE' as const, 
        lastRunAt: '', 
        nextRunAt: '', 
        createdAt: '2026-08-01T00:00:00.000Z' 
      }] 
    };
    
    fileTenantRepository.saveTenantData('tenant-b', newData);
    
    const updatedData = fileTenantRepository.getTenantData('tenant-b');
    expect(updatedData.automatedTasks.length).toBe(1);
    expect(writeSpy).toHaveBeenCalled();
  });
});
