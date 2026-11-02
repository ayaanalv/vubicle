import { describe, it, expect } from 'vitest';
import { errorDetail, isStorageError, storageErrorMessage, StorageError } from '../../src/app/ingest';

describe('error messages testers can pass on', () => {
  it('turns any error into one short line', () => {
    expect(errorDetail(new TypeError('Math.sumPrecise is not a function'))).toBe('TypeError: Math.sumPrecise is not a function');
    expect(errorDetail('plain string')).toBe('Error: plain string');
    expect(errorDetail(new Error('a\n   b ' + 'x'.repeat(400))).length).toBe(160);
  });
  it('tells full storage apart from blocked storage', () => {
    expect(storageErrorMessage(new DOMException('full', 'QuotaExceededError'))).toMatch(/no storage space left/);
    const blocked = storageErrorMessage(new DOMException('The user denied permission to access the database.', 'SecurityError'));
    expect(blocked).toMatch(/isn’t letting Vubicle save files/);
    expect(blocked).toContain('(Details: SecurityError: The user denied permission to access the database.)');
    expect(storageErrorMessage(new StorageError('already explained'))).toBe('already explained');
  });
  it('treats storage failures as storage, and file problems as file problems', () => {
    expect(isStorageError(new DOMException('x', 'QuotaExceededError'))).toBe(true);
    expect(isStorageError(new DOMException('x', 'UnknownError'))).toBe(true);
    expect(isStorageError(new TypeError('bad pdf'))).toBe(false);
  });
});
