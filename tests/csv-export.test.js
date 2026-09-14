import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeCsvField, toExcelText } from '../src/utils/csv.js';

test('CSV export forces contact_phone to Excel text', () => {
  assert.equal(escapeCsvField(toExcelText('0851234567')), '"=""0851234567"""');
  assert.equal(escapeCsvField(toExcelText('08"123')), '"=""08""""123"""');
});
