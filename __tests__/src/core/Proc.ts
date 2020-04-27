import * as fc from 'fast-check';
import { identity, unsafeCoerce } from 'fp-ts/lib/function';
import * as E from 'fp-ts/lib/Either';
import * as O from 'fp-ts/lib/Option';

import {
  Proc,
  proc,
  mkSys,
  map,
  AsyncValue,
  lift,
  liftFn,
  mkExogenousError,
  mkPreempt,
} from '../../../src/core/Proc';

const logger = () => () => void 0;
const mkSysSimple = () => mkSys(logger);
const run = <A>({ proc }: Proc<A>, sys = mkSysSimple()) => proc(sys);
const runT = <T extends Proc<unknown>[]>(
  ...ar: T
): Proc<
  { [K in keyof T]: T[K] extends Proc<infer R> ? AsyncValue<R> : never }
> => {
  const sys = mkSysSimple();
  return unsafeCoerce(Promise.all(ar.map(({ proc }) => proc(sys))));
};

const compose = <A, B, C>(f: (b: B) => C, g: (a: A) => B): ((a: A) => C) => (
  a
) => f(g(a));

// Compose curried
const composeC = <A, B, C>(f: (b: B) => C) => (
  g: (a: A) => B
): ((a: A) => C) => (a) => f(g(a));

const arbProc = <T>(arb: fc.Arbitrary<T>) => arb.map(proc.of);

describe('laws', () => {
  // (\x -> $ x)
  const callR = <A>(a: A) => <B>(f: (a: A) => B) => f(a);

  describe('functor laws', () => {
    // fmap id fa = id fa
    test('identity', () => {
      fc.assert(
        fc.asyncProperty(arbProc(fc.anything()), async (fa) => {
          expect(
            await run(
              // fmap id fa
              map(identity)(fa)
            )
          ).toEqual(
            await run(
              // id fa
              identity(fa)
            )
          );
        })
      );
    });

    // fmap (f . g) fa =  (fmap f . fmap g) fa
    test('composition', () => {
      fc.assert(
        fc.asyncProperty(
          arbProc(fc.anything()),
          fc.func(fc.anything()),
          fc.func(fc.anything()),
          async (fa, f, g) => {
            expect(
              await run(
                // fmap (f . g) fa
                map(compose(f, g))(fa)
              )
            ).toEqual(
              await run(
                // (fmap f . fmap g) fa
                compose(map(f), map(g))(fa)
              )
            );
          }
        )
      );
    });
  });

  describe('applicative laws', () => {
    const pure = proc.of;

    // pure id <*> v = v
    test('identity', () => {
      fc.assert(
        fc.asyncProperty(arbProc(fc.anything()), async (v) => {
          expect(
            await run(
              // pure id <*> v
              proc.ap(pure(identity), unsafeCoerce(v))
            )
          ).toEqual(
            await run(
              // v
              v
            )
          );
        })
      );
    });

    // pure (.) <*> u <*> v <*> w = u <*> (v <*> w)
    test('composition', () => {
      fc.assert(
        fc.asyncProperty(
          arbProc(fc.string()),
          arbProc(fc.func(fc.anything())),
          arbProc(fc.func(fc.anything())),
          async (w, v, u) => {
            expect(
              await run(
                // <*> w
                proc.ap(
                  // <*> v
                  proc.ap(
                    // pure (.) <*> u
                    proc.ap(pure(composeC), u),
                    v
                  ),
                  w
                )
              )
            ).toEqual(
              await run(
                // u <*> (v <*> w)
                proc.ap(u, proc.ap(v, w))
              )
            );
          }
        )
      );
    });

    // u <*> pure y = pure ($ y) <*> u
    test('interchange', () => {
      fc.assert(
        fc.asyncProperty(
          fc.anything(),
          arbProc(fc.func(fc.anything())),
          async (y, u) => {
            expect(
              await run(
                // u <*> pure y
                proc.ap(u, pure(y))
              )
            ).toEqual(
              await run(
                // pure ($ y) <*> u
                proc.ap(pure(callR(y)), u)
              )
            );
          }
        )
      );
    });

    // pure f <*> pure x = pure (f x)
    test('homomorphism', () => {
      fc.assert(
        fc.asyncProperty(
          fc.anything(),
          fc.func(fc.anything()),
          async (x, f) => {
            expect(
              await run(
                // pure f <*> pure x
                proc.ap(pure(f), pure(x))
              )
            ).toEqual(
              await run(
                // pure (f x)
                pure(f(x))
              )
            );
          }
        )
      );
    });
  });

  describe('monad laws', () => {
    const ret = proc.of;

    // return a >>= f = f a
    test('left identity', () => {
      fc.assert(
        fc.asyncProperty(
          fc.anything(),
          fc.func(arbProc(fc.anything())),
          async (a, f) => {
            expect(
              await run(
                // return a >>= f
                proc.chain(ret(a), f)
              )
            ).toEqual(
              await run(
                // f a
                f(a)
              )
            );
          }
        )
      );
    });

    // m >>= return = m
    test('right identity', () => {
      fc.assert(
        fc.asyncProperty(arbProc(fc.anything()), async (m) => {
          expect(
            await run(
              // m >>= return
              proc.chain(m, ret)
            )
          ).toEqual(
            await run(
              // m
              m
            )
          );
        })
      );
    });

    // (m >>= f) >>= g = m >>= (\x -> f x >>= g)
    test('associativity', () => {
      fc.assert(
        fc.asyncProperty(
          arbProc(fc.string()),
          fc.func(arbProc(fc.anything())),
          fc.func(arbProc(fc.anything())),
          async (m, f, g) => {
            expect(
              await run(
                // (m >>= f) >>= g
                proc.chain(proc.chain(m, f), g)
              )
            ).toEqual(
              await run(
                // m >>= (\x -> f x >>= g)
                proc.chain(m, (x) => proc.chain(f(x), g))
              )
            );
          }
        )
      );
    });
  });
});

test('either failure conversion', () => {
  expect(run(lift(() => Promise.reject('error')))).resolves.toEqual(
    E.left(mkExogenousError('error'))
  );

  expect(
    run(
      liftFn(() => {
        throw new Error('error');
      })
    )
  ).resolves.toEqual(E.left(mkExogenousError('error')));
});

test('interupt', () => {
  const sys = mkSysSimple();
  sys.interrupt(mkExogenousError('error'));
  expect(sys.shouldPreempt()).toEqual(true);
  expect(sys.mutInterrupt).toEqual(O.some(mkExogenousError('error')));
});

test('mutInterupt set on failure', async () => {
  const sys = mkSysSimple();
  await lift(() => Promise.reject('error')).proc(sys);

  expect(sys.shouldPreempt()).toEqual(true);
  expect(sys.mutInterrupt).toEqual(O.some(mkExogenousError('error')));
});

test('cascading proc failure', () => {
  const proc1 = proc.of(3);
  const proc2 = proc.map(proc1, () => {
    throw new Error('error');
  });

  const proc3 = proc.map(proc2, (x) => x + 1);

  expect(run(proc3)).resolves.toEqual(E.left(mkExogenousError('error')));
  expect(run(proc.chain(proc3, (x) => proc.of(x ^ 2)))).resolves.toEqual(
    E.left(mkExogenousError('error'))
  );
});

test('interrupt failure', async () => {
  expect(
    runT(
      lift(() => Promise.reject('error')),
      lift(() => Promise.resolve(3)),
      lift(() => Promise.resolve(true))
    )
  ).resolves.toEqual([
    E.left(mkExogenousError('error')),
    E.left(mkPreempt(O.some(unsafeCoerce(E.right(3))))),
    E.left(mkPreempt(O.some(unsafeCoerce(E.right(true))))),
  ]);

  const sys = mkSysSimple();
  expect([
    await run(
      lift(() => Promise.reject('error')),
      sys
    ),
    await run(proc.of(3), sys),
  ]).toEqual([E.left(mkExogenousError('error')), E.left(mkPreempt())]);
});
