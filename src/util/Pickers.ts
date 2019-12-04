import { EntityType } from 'rival-api-sdk-js';

import { Picker } from '../lib/Expr';

export const first = <E extends EntityType>(): Picker<E> => results =>
  results[0];
