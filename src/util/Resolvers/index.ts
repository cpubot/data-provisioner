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

export const withExternal = <E extends EntityType, T>(
  getExternal: (e: ES.TypeMap[E]) => T | Promise<T>,
  makeResolver: (t: T) => Resolver<E>
): Resolver<E> => async (e, transactionId) => {
  const t = await getExternal(e);
  return makeResolver(t)(e, transactionId);
};

export const withExternalSideEffect = <E extends EntityType, T>(
  getExternal: (e: ES.TypeMap[E]) => T | Promise<T>
) => withExternal<E, T>(getExternal, () => t => Promise.resolve(t));

// Right-to-left composition
export const compose = <E extends EntityType>(
  a: Resolver<E>,
  b: Resolver<E>
): Resolver<E> => async (e, transactionId) => {
  const e1 = await b(e, transactionId);
  return a(e1, transactionId);
};

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
