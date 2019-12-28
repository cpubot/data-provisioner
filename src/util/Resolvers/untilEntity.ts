import rivalApiSdkJs, {
  EntitySchemas as ES,
  EntityType,
  snakeCaseToEntityTypeKey,
} from 'rival-api-sdk-js';

import { Resolver } from '../../lib/Expr';

export const untilEntity = <E extends EntityType>(
  pred: (e: ES.TypeMap[E]) => boolean
): Resolver<E> => e =>
  new Promise((resolve, reject) => {
    const etk = snakeCaseToEntityTypeKey(e.type);
    const query = { id: e.id };

    const unbind = () => {
      stream.off('data', onStreamData as any);
      stream.off('error', makeError);
      clearInterval(interval);
    };

    const makeError = (e?: unknown) => {
      unbind();
      reject(e);
    };

    const makeSuccess = (e: ES.TypeMap[E]) => {
      unbind();
      resolve(e);
    };

    const attemptResolution = (e: ES.TypeMap[E]) => {
      if (pred(e)) {
        makeSuccess(e);
      }
    };

    const onStreamData = (data: Record<typeof etk, ES.TypeMap[E][]>) =>
      data[etk].length === 0 ? makeError() : attemptResolution(data[etk][0]);

    const stream = rivalApiSdkJs
      .instance()
      .stream({ [etk]: query })
      .on('data', onStreamData as any)
      .on('error', makeError);

    const poll = () =>
      rivalApiSdkJs
        .instance()
        .entityClient(etk)
        .list(query, { noCache: true })
        .then((data: ES.TypeMap[E][]) =>
          data.length === 0 ? makeError() : attemptResolution(data[0])
        )
        .catch(makeError);

    const interval = setInterval(poll, 5 * 1000);
  });
