import { EntitySchemas as ES, EntityType } from 'rival-api-sdk-js';

import { AttrRecurse, ExprFilter, create } from './Expr';

export const createSpec = <
  E extends EntityType,
  F extends (keyof ES.TypeMap[E]['attributes'])[]
>(
  entityType: E,
  _: F,
  resolver?: ExprFilter<E, 'Create'>['resolver']
) => (fields: AttrRecurse<E, F>) =>
  create(entityType, fields as Partial<AttrRecurse<E>>, resolver);
