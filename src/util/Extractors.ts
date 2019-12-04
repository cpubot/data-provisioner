import { EntityType } from 'rival-api-sdk-js';

import { Extractor } from '../lib/Expr';

export const entityId = <E extends EntityType>(): Extractor<E, string> => e =>
  e.id;
