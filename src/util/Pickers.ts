import { EntityType } from 'ts-api-types';

import { Picker } from '../lib/Expr';

export const first = <E extends EntityType>(): Picker<E> => results =>
  results[0];
