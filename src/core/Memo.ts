import { Monad2 } from 'fp-ts/lib/Monad';
import { flow, constant } from 'fp-ts/lib/function';

const URI = 'Memo';
type URI = typeof URI;

declare module 'fp-ts/lib/HKT' {
  interface URItoKind2<E, A> {
    readonly Memo: Memo<E, A>;
  }
}

// Unary function memoizer
export type Memo<A, B> = {
  (a: A): B;
};

// Memo constructor
// ```
// f = mkMemo((i: number) => i + 1) = (number -> number)
// ```
export const mkMemo = <A, B>(f: (a: A) => B): Memo<A, B> => {
  const valueMap: Map<A, B> = new Map();

  return (a) => {
    if (!valueMap.has(a)) {
      const b = f(a);
      valueMap.set(a, b);
      return b;
    }

    return valueMap.get(a)!;
  };
};

// (->) Monad instance
export const memo: Monad2<URI> = {
  URI,
  // of :: Monad m => a -> m a
  of: flow(constant, mkMemo),

  // map :: Functor f => f a -> (a -> b) -> f b
  map: (fa, f) => mkMemo(flow(fa, f)),

  // ap :: Applicative f => f (a -> b) -> f a -> f b
  ap: (fab, fa) => mkMemo((a) => fab(a)(fa(a))),

  // chain :: Monad m => m a -> (a -> m b) -> m b
  chain: (fa, f) => mkMemo((a) => f(fa(a))(a)),
};
