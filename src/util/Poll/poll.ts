import rivalApiSdkJs from 'rival-api-sdk-js';
import {
  EntitySchemas as ES,
  EntityType,
  entityTypeToEntityTypeKey,
} from 'ts-api-types';

export const poll = <QT extends EntityType>(
  pred: (result: ES.TypeMap[QT][]) => boolean
) => <QT1 extends QT>(
  queryTarget: QT1,
  query: Record<string, any>
): Promise<ES.TypeMap[QT1][]> =>
  new Promise(async (resolve, reject) => {
    const etk = entityTypeToEntityTypeKey(queryTarget);

    const unbind = () => {
      stream.off('data', onStreamData as any);
      stream.off('error', makeError);
      clearInterval(interval);
    };

    const makeError = (error?: unknown) => {
      unbind();
      reject(error);
    };

    const makeSuccess = (result: ES.TypeMap[QT1][]) => {
      unbind();
      resolve(result);
    };

    const attemptResolution = (result: ES.TypeMap[QT1][]) => {
      if (pred(result)) {
        makeSuccess(result);
      }
    };

    const onStreamData = (data: Record<typeof etk, ES.TypeMap[QT1][]>) =>
      attemptResolution(data[etk]);

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
        .then(attemptResolution)
        .catch(makeError);

    const interval = setInterval(poll, 5 * 1000);
  });
