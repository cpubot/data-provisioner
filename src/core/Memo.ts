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
