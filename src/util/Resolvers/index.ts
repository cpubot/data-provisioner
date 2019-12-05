import { EntitySchemas as ES, EntityType } from 'rival-api-sdk-js';

import { Resolver } from '../../lib/Expr';
import { until } from './until';

export { until };

export const id = <E extends EntityType>(): Resolver<E> => e =>
  Promise.resolve(e);

export const hasAttrs = <
  E extends EntityType,
  F extends (keyof ES.TypeMap[E]['attributes'])[]
>(
  f: F
): Resolver<E> =>
  until(e =>
    f.every(
      attr =>
        (e.attributes as ES.TypeMap[E]['attributes'])[attr] !== null &&
        (e.attributes as ES.TypeMap[E]['attributes'])[attr] !== undefined
    )
  );
