import { EntityType } from 'ts-api-types';

import { Extractor } from '../lib/Expr';

export const entityId = <E extends EntityType>(): Extractor<E, string> => e =>
  e.id;
