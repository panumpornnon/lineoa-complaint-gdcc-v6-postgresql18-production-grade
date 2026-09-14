import test from 'node:test';
import assert from 'node:assert/strict';

import { isElevatedStaff, requireRoles } from '../src/middleware/admin-auth.js';

test('treats DEV as elevated staff', () => {
  assert.equal(isElevatedStaff({ role: 'dev' }), true);
});

test('allows DEV through system-admin role checks', () => {
  const middleware = requireRoles('admin', 'dev');
  let nextError;

  middleware({ admin: { role: 'dev' } }, {}, (error) => {
    nextError = error;
  });

  assert.equal(nextError, undefined);
});
