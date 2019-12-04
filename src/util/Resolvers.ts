import { EntityType } from 'rival-api-sdk-js';

import { Resolver } from '../lib/Expr';

export const id = <E extends EntityType>(): Resolver<E> => e =>
  Promise.resolve(e);
