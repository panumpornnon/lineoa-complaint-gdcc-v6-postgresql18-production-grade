import test from 'node:test';
import assert from 'node:assert/strict';
import { createReferenceNumber } from '../src/utils/reference.js';

test('creates deterministic Bangkok complaint reference', () => {
  const date = new Date('2026-07-13T17:30:00.000Z'); // 14 Jul 2026 in Bangkok
  assert.equal(createReferenceNumber(42, date), 'CMP-20260714-000042');
});
