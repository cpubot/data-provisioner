import { collect, mapTree } from '../../src/util';
import { isProc, proc } from '../../src/core/Proc';

test('collect', () => {
  const proc1 = proc.of(3);
  const proc2 = proc.of('hello');
  const proc3 = proc.of(false);
  const proc4 = proc.of(true);

  const collectProc = collect(isProc);

  expect(collectProc([proc1])).toEqual([proc1]);

  expect(
    collectProc({
      x: proc1,
      y: [proc2],
      z: { x: proc3 },
      a: 3,
      b: 30,
      c: { x: true },
    })
  ).toEqual([proc1, proc2, proc3]);

  expect(collectProc(proc1)).toEqual([proc1]);

  expect(
    collectProc([
      proc1,
      { x: proc2, y: [proc3], z: true },
      'hello world',
      [proc4],
    ])
  ).toEqual([proc1, proc2, proc3, proc4]);
});

test('mapTree', () => {
  const inc = mapTree((x: unknown): x is number => typeof x === 'number')(
    (x) => x + 1
  );

  expect(inc(1)).toEqual(2);

  expect(inc([1, 3, true, 'hello world'])).toEqual([2, 4, true, 'hello world']);

  expect(inc([1, { x: 5, y: 10, z: [30, 'hello world'] }, true])).toEqual([
    2,
    { x: 6, y: 11, z: [31, 'hello world'] },
    true,
  ]);

  expect(inc({ x: 5, y: [10, { x: 100 }], z: true })).toEqual({
    x: 6,
    y: [11, { x: 101 }],
    z: true,
  });
});
