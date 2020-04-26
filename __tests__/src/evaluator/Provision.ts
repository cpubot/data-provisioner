import * as E from 'fp-ts/lib/Either';
import { unsafeCoerce } from 'fp-ts/lib/function';

import { provision } from '../../../src/evaluator/Provision';
import { Runtime, fromJSON, fromArray } from '../../../src/evaluator/Runtime';

import { proc, liftFn } from '../../../src/core/Proc';

const logger = () => () => void 0;

test('successful provision', async () => {
  const p1 = proc.of(3);
  const p2 = proc.map(p1, (x) => Math.pow(x, 2));
  const p3 = proc.chain(p2, (x) => proc.of(x * 3));
  const p4 = proc.map(p3, (x) => (y: number) => x * y * 10);
  const p5 = proc.ap(p4, proc.of(10));

  const { right: runtime }: E.Right<Runtime> = unsafeCoerce(
    await provision(logger)([p1, p2, p3, p4, p5])
  );

  expect(runtime.get(p1)).toEqual(3);
  expect(runtime.get(p2)).toEqual(9);
  expect(runtime.get(p3)).toEqual(27);
  expect(runtime.get(p5)).toEqual(2700);
});

test('runtime extraction without explicit provision', async () => {
  const p1 = proc.of(3);
  const p2 = proc.map(p1, (x) => Math.pow(x, 2));

  const { right: runtime }: E.Right<Runtime> = unsafeCoerce(
    await provision(logger)(p2)
  );

  expect(runtime.get(p1)).toEqual(3);
});

test('provision failure', async () => {
  const p1 = liftFn(() => {
    throw new Error('oh no');
  });
  const p2 = proc.map(p1, (x) => !x);

  const { left: e }: E.Left<unknown> = unsafeCoerce(
    await provision(logger)(p2)
  );

  expect(e).toEqual('oh no');
});

test('toJSON', async () => {
  const p1 = proc.of(3);
  const p2 = proc.map(p1, (x) => Math.pow(x, 2));

  const { right: runtime }: E.Right<Runtime> = unsafeCoerce(
    await provision(logger)(p2)
  );

  expect(runtime.toJSON()).toEqual(`[[${p1.id},3],[${p2.id},9]]`);
});

test('toArray', async () => {
  const p1 = proc.of(3);
  const p2 = proc.map(p1, (x) => Math.pow(x, 2));

  const { right: runtime }: E.Right<Runtime> = unsafeCoerce(
    await provision(logger)(p2)
  );

  expect(runtime.toArray()).toEqual([
    [p1.id, 3],
    [p2.id, 9],
  ]);
});

test('fromJSON', () => {
  const p1 = proc.of(3);
  const p2 = proc.map(p1, (x) => Math.pow(x, 2));
  const runtime = fromJSON(`[[${p1.id},3],[${p2.id},9]]`);

  expect(runtime.get(p1)).toEqual(3);
  expect(runtime.get(p2)).toEqual(9);
});

test('fromArray', () => {
  const p1 = proc.of(3);
  const p2 = proc.map(p1, (x) => Math.pow(x, 2));
  const runtime = fromArray([
    [p1.id, 3],
    [p2.id, 9],
  ]);

  expect(runtime.get(p1)).toEqual(3);
  expect(runtime.get(p2)).toEqual(9);
});
