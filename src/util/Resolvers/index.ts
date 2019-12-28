import { EntitySchemas as ES, EntityType } from 'rival-api-sdk-js';

import { Resolver } from '../../lib/Expr';
import { untilEntity } from './untilEntity';

export { untilEntity };

export const id = <E extends EntityType>(): Resolver<E> =>
  Promise.resolve.bind(Promise);

export const untilHasAttrs = <
  E extends EntityType,
  F extends (keyof ES.TypeMap[E]['attributes'])[]
>(
  f: F
): Resolver<E> =>
  untilEntity(e =>
    f.every(
      attr =>
        (e.attributes as ES.TypeMap[E]['attributes'])[attr] !== null &&
        (e.attributes as ES.TypeMap[E]['attributes'])[attr] !== undefined
    )
  );

export const withExternal = <E extends EntityType, T>(
  getExternal: (e: ES.TypeMap[E]) => T | Promise<T>,
  makeResolver: (t: T) => Resolver<E>
): Resolver<E> => async e => {
  const t = await getExternal(e);
  return makeResolver(t)(e);
};

export const withExternalSideEffect = <E extends EntityType, T>(
  getExternal: (e: ES.TypeMap[E]) => T | Promise<T>
) => withExternal<E, T>(getExternal, () => t => Promise.resolve(t));

// Right-to-left composition
export const compose = <E extends EntityType>(
  a: Resolver<E>,
  b: Resolver<E>
): Resolver<E> => async e => {
  const e1 = await b(e);
  return a(e1);
};

// Left-to-right composition
export const composeR = <E extends EntityType>(
  a: Resolver<E>,
  b: Resolver<E>
): Resolver<E> => compose(b, a);
