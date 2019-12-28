import { poll } from './poll';

export { poll };

export const pollUntilNotEmpty = poll(result => result.length !== 0);
