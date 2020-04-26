import { Monad1 } from 'fp-ts/lib/Monad';
import { Semigroup } from 'fp-ts/lib/Semigroup';
import { Monoid } from 'fp-ts/lib/Monoid';
import * as Apply from 'fp-ts/lib/Apply';
import { Reader } from 'fp-ts/lib/Reader';
import * as TE from 'fp-ts/lib/TaskEither';
import * as E from 'fp-ts/lib/Either';
import * as O from 'fp-ts/lib/Option';
import { IO } from 'fp-ts/lib/IO';
import { Lazy, flow, constant } from 'fp-ts/lib/function';
import { pipeable } from 'fp-ts/lib/pipeable';

import { isObject, curry2 } from '../util';

import { mkMemo } from './Memo';

declare module 'fp-ts/lib/HKT' {
  interface URItoKind<A> {
    readonly Proc: Proc<A>;
  }
}

const URI = 'Proc';
type URI = typeof URI;

// UniqueID generator for procs.
// Side-effect
let idSeed = 0;
const mkId = () => idSeed++;

// Two types of errors are exposed, summed via SysError.
const _isSysError = '_isSysError';
type _isSysError = typeof _isSysError;
// ExogenousError refers to any error that occurred outside
// of the Proc system itself. This will house things like
// API errors and other exceptions that aren't related
// to the innards of this system.
export type ExogenousError<E = unknown> = {
  _tag: 'Exogenous';
  e: E;
  _isSysError: _isSysError;
};
// Preempt is as an error type which semantically encapsulates
// the preemptive cancelling of a Proc due to a previous failure
// of some other Proc. It contains an optional `result` parameter
// which houses any result which may have returned from an in-flight
// process / request which was instantiated before the preempt signal
// was given. This allows us to invert processes / requests that were
// already in-flight before the preempt signal was given.
type Preempt<A = unknown> = {
  _tag: 'Preempt';
  _isSysError: _isSysError;
  result: O.Option<E.Right<A>>;
};
export type SysError<E = unknown> = Preempt | ExogenousError<E>;

// Error type constructors
export const mkExogenousError = <E = unknown>(e: E): ExogenousError<E> => ({
  _tag: 'Exogenous',
  e,
  _isSysError,
});
export const mkPreempt = <A>(
  result: Preempt<A>['result'] = O.none
): Preempt<A> => ({
  _tag: 'Preempt',
  _isSysError,
  result,
});
export const isSysError = (e: any): e is SysError =>
  isObject(e) && e._isSysError === _isSysError;
export const isExogenousError = (e: any): e is ExogenousError =>
  isSysError(e) && e._tag === 'Exogenous';
export const isPreempt = (e: any): e is Preempt =>
  isSysError(e) && e._tag === 'Preempt';

// This type refers to the "System" context to which some
// set of procs will be bound. It is effectively the runtime
// from the perspective of a set of procs. It facilitates
// inter-process communication of failure between procs,
// stores the results of procs, logging, and invocation
// of all bound procs.
export type Sys = {
  // Mutable reference to some exogenous failure. The mutability
  // is what faciliates "live" access between procs. Only one
  // ExogenousError is necessary, as everything will be signaled
  // to terminate upon first error.
  mutInterrupt: O.Option<ExogenousError>;
  // Helper to allow procs to know whether they should interrupt.
  readonly shouldPreempt: Lazy<boolean>;
  // Helper to set the `mutInterupt` parameter. This will trigger cascading
  // preempts.
  readonly interrupt: (e: ExogenousError) => { then: <A>(f: Lazy<A>) => A };
  // Logging function
  readonly logger: (s: string) => IO<void>;
  // Map of procId -> Promise<Response>
  readonly responseMap: Map<number, AsyncValue<unknown>>;
  // Helper to insert a proc's response into the `responseMap`.
  readonly persistResponse: <A>(id: number, a: AsyncValue<A>) => AsyncValue<A>;
  // Helper to facilitate execution of bound procs.
  readonly run: Lazy<Promise<Map<number, Value<unknown>>>>;
};

// Sys constructor
export const mkSys = (logger: Sys['logger']): Sys => {
  const sys: Sys = {
    mutInterrupt: O.none,
    logger,
    interrupt: (e) => {
      sys.mutInterrupt = O.some(e);

      return {
        then: (f) => f(),
      };
    },
    shouldPreempt: () => O.isSome(sys.mutInterrupt),
    responseMap: new Map(),
    persistResponse: (id, a) => {
      sys.responseMap.set(id, a);
      return a;
    },
    run: () => {
      const ps: Promise<readonly [number, Value<unknown>]>[] = [];
      for (const [id, p] of sys.responseMap) {
        ps.push(p.then((v) => [id, v] as const));
      }

      return Promise.all(ps).then((x) => new Map(x));
    },
  };

  return sys;
};

const _isProc = '_isProc';
type _isProc = typeof _isProc;
export const isProc = (e: any): e is Proc<unknown> =>
  isObject(e) && e._isProc === _isProc;

export type Value<A> = E.Either<SysError, A>;
export type AsyncValue<A> = Promise<Value<A>>;
type SysReader<A> = Reader<Readonly<Sys>, A>;
type SysAsyncValue<A> = SysReader<AsyncValue<A>>;
type LazyAsyncValue<A> = Lazy<AsyncValue<A>>;
type SysLazyAsyncValue<A> = SysReader<LazyAsyncValue<A>>;

export type Proc<A> = {
  id: number;
  _isProc: _isProc;
  proc: SysAsyncValue<A>;
};

// Each proc has access to the `Sys` instance and should return
// a function which returns a promise (`Lazy<Promise>`), resolving
// to the ultimate value associated with the proc. We need
// laziness here to prevent immediate invocation of promises.
type MkProc = <A>(t: SysLazyAsyncValue<A>) => Proc<A>;

export const mkProc: MkProc = (t, id = mkId()) => ({
  id,
  _isProc,
  // Each proc is memoized to prevent duplicate requests
  proc: mkMemo((r) =>
    // Store the response in sys
    r.persistResponse(
      id,
      r.shouldPreempt()
        ? // Preempt before executing, if signal has been given.
          Promise.resolve(E.left(mkPreempt()))
        : t(r)().then(
            (x) => {
              // Left indicates failure
              if (E.isLeft(x)) {
                // If failure is a preempt, simply return it.
                if (isPreempt(x.left)) {
                  return x;
                }
                // Otherwise, we've encountered an exogenous error.
                // Notify `Sys` and return the error.
                return r.interrupt(x.left).then(constant(x));
              }

              // If the task completed successfully, but signal to preempt
              // has been given, convert response to Left to indicate failure
              // (and prevent chained tasks from executing), and store the
              // response on the Preempt type so it can be later inverted.
              return r.shouldPreempt() ? E.left(mkPreempt(O.some(x))) : x;
            },
            (e) => {
              // Catch all exceptions and convert to ExogenousError
              const e1 = E.left(
                mkExogenousError(e instanceof Error ? e.message : e)
              ) as E.Left<ExogenousError>;
              return r.interrupt(e1.left).then(constant(e1));
            }
          )
    )
  ),
});

// Helper to catch promise rejections and convert to Left<ExogenousError>
const tryCatch = <A>(p: Lazy<Promise<A>>) => TE.tryCatch(p, mkExogenousError);
// Helper to catch exceptions and convert to Left<ExogenousError>
const tryCatchFn = <A>(f: Lazy<A>) =>
  E.tryCatch(f, (e) => mkExogenousError(e instanceof Error ? e.message : e));

// Helper to lift an arbitrary Lazy<Promise> into a Proc.
export const lift = <A>(p: Lazy<Promise<A>>) => mkProc(() => tryCatch(p));
// Helper to lift an arbitrary Lazy<Promise> needing access to Sys into a Proc.
export const liftSys = <A>(f: SysReader<Promise<A>>) =>
  mkProc((r) => tryCatch(() => f(r)));

// Helper to lift an arbitrary function into a Proc.
export const liftFn = <A>(f: Lazy<A>) =>
  mkProc(() => () => Promise.resolve(tryCatchFn(f)));
// Helper to lift an arbitrary function needing access to Sys into a Proc.
export const liftFnSys = <A>(f: SysReader<A>) =>
  mkProc((r) => () => Promise.resolve(tryCatchFn(() => f(r))));

export const proc: Monad1<URI> = {
  URI,
  // of :: Monad m => a -> m a
  of: flow(constant, liftFn),

  // map :: Functor f => f a -> (a -> b) -> f b
  map: (fa, f) => mkProc((r) => () => fa.proc(r).then(E.map(f))),

  // ap :: Applicative f => f (a -> b) -> f a -> f b
  ap: (fab, fa) =>
    mkProc((r) => () =>
      Promise.all([fab.proc(r), fa.proc(r)]).then(([mf, ma]) =>
        E.either.map(Apply.sequenceT(E.either)(mf, ma), ([f, a]) => f(a))
      )
    ),

  // chain :: Monad m => m a -> (a -> m b) -> m b
  chain: (ma, f) =>
    mkProc((r) => () =>
      ma.proc(r).then((a) => (E.isLeft(a) ? a : f(a.right).proc(r)))
    ),
};

export const getSemigroup = <A>(S: Semigroup<A>): Semigroup<Proc<A>> => ({
  concat: (x, y) => proc.ap(proc.map(x, curry2(S.concat)), y),
});

export const getMonoid = <A>(M: Monoid<A>): Monoid<Proc<A>> => ({
  concat: getSemigroup(M).concat,
  empty: proc.of(M.empty),
});

export const {
  map,
  ap,
  apFirst,
  apSecond,
  chain,
  chainFirst,
  flatten,
} = pipeable(proc);

export const sequenceT = Apply.sequenceT(proc);
export const sequenceS = Apply.sequenceS(proc);
