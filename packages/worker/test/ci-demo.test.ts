import { expect, it } from 'vitest';

it('deliberately fails to prove CI goes red', () => {
  expect(1 + 1).toBe(3);
});
