import rivalApiSdkJs, {
  EntitySchemas as ES,
  EntityType,
} from 'rival-api-sdk-js';
import { MessageHandler } from 'rival-api-sdk-js/dist/services/PublicEntitySync';

import { Resolver } from '../../lib/Expr';
import { untilEntity } from './untilEntity';

export { untilEntity };

export const id = <E extends EntityType>(): Resolver<E> => e =>
  Promise.resolve(e);

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

export const toResolver = <E extends EntityType>(
  effect: (e: ES.TypeMap[E]) => Promise<any>
): Resolver<E> => e => effect(e).then(() => e);

// Right-to-left composition
export const compose = <E extends EntityType>(
  a: Resolver<E>,
  b: Resolver<E>
): Resolver<E> => (e, transactionId) =>
  b(e, transactionId).then(e1 => a(e1, transactionId));

// Left-to-right composition
export const composeR = <E extends EntityType>(
  a: Resolver<E>,
  b: Resolver<E>
): Resolver<E> => compose(b, a);

export const awaitTransaction = <E extends EntityType>(
  timeout = 30000
): Resolver<E> => (e, transactionId) =>
  new Promise((resolve, reject) => {
    const entitySync = rivalApiSdkJs.instance().getEntitySyncService();

    const timer = setTimeout(() => {
      unbind();
      reject(
        new Error(
          `Resolver for ${JSON.stringify(
            e,
            null,
            2
          )} timed out.\nTIMEOUT=${timeout}ms`
        )
      );
    }, timeout);

    const unbind = () => {
      clearTimeout(timer);
      entitySync.offMessage(handleMessage);
    };

    const handleMessage: MessageHandler = event => {
      if (
        event.data.some(
          ({ meta: { transaction_id } }) => transactionId === transaction_id
        )
      ) {
        unbind();
        resolve(e);
      }
    };

    entitySync.onMessage(handleMessage);
  });
