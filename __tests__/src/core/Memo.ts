import { mkMemo } from '../../../src/core/Memo';

test('memoizes', () => {
  const f = jest.fn((x: number) => x + 1);
  const mf = mkMemo(f);

  expect(mf(1)).toEqual(2);
  expect(mf(1)).toEqual(2);
  expect(mf(1)).toEqual(2);
  expect(f).toHaveBeenCalledTimes(1);
});
