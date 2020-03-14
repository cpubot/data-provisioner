export const isObject = (o: any): o is Record<string, any> =>
  o ? Object.getPrototypeOf(o) === Object.prototype : false;

export const omit = <R extends Record<any, any>, K extends (keyof R)[]>(
  r: R,
  k: K
): Omit<R, K[0]> => {
  const set = new Set(k);
  return Object.entries(r).reduce(
    (newObj, [key, value]) =>
      set.has(key) ? newObj : { ...newObj, [key]: value },
    {} as Omit<R, K[0]>
  );
};
