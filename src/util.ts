import { Refinement } from 'fp-ts/lib/function';

export const isObject = (o: any): o is Record<string, any> =>
  o ? Object.getPrototypeOf(o) === Object.prototype : false;

export const flat = (ar: any[]): any[] =>
  ar.reduce((ar1, v) => {
    if (Array.isArray(v)) {
      return ar1.concat(flat(v));
    }
    ar1.push(v);
    return ar1;
  }, [] as unknown[]);

export type Tree<A> = A | unknown | Tree<A>[] | { [key: string]: Tree<A> };

export const mapTree = <A, B>(predicate: Refinement<unknown, A>) => (
  map: (a: A) => B
) => <T extends Tree<A>>(s1: T): Tree<B> => {
  if (predicate(s1)) {
    return map(s1);
  }
  if (Array.isArray(s1)) {
    return s1.map(mapTree(predicate)(map));
  }
  if (isObject(s1)) {
    return Object.entries(s1).reduce(
      (s2, [key, value]) => ({
        ...s2,
        [key]: mapTree(predicate)(map)(value),
      }),
      {}
    );
  }

  return s1;
};

export const collect = <A>(predicate: Refinement<unknown, A>) => <
  T extends Tree<A>
>(
  s: T
): A[] => {
  if (predicate(s)) {
    return [s];
  }
  if (Array.isArray(s)) {
    return flat(s.map(collect(predicate)));
  }
  if (isObject(s)) {
    return flat(Object.values(s).map(collect(predicate)));
  }
  return [];
};

// Weak curry — we don't allow full application
// (Generally because Typescript doesn't handle the
// curried types in an elegant way).
export const curry2 = <A, B, C>(
  f: (a: A, b: B) => C
): ((a: A) => (b: B) => C) => (a) => (b) => f(a, b);

// Weak curry again — we require partial application of first
// two arguments.
export const curry3 = <A, B, C, D>(
  f: (a: A, b: B, c: C) => D
): ((a: A, b: B) => (c: C) => D) => (a, b) => (c) => f(a, b, c);
