import { Refinement } from 'fp-ts/lib/function';
import * as E from 'fp-ts/lib/Either';

import rivalApiSdkJs, { IUploadEntity, Transaction } from 'rival-api-sdk-js';
import {
  EntitySchemas as ES,
  EntityType,
  entityTypeToEntityTypeKey,
  Entity,
} from 'ts-api-types';

import { liftSys, mkProc, mkPreempt, mkExogenousError } from '../core/Proc';
import { isObject } from '../util';

// This module wraps SDK API semantics into Proc semantics.

export type Schema<E extends EntityType> = ES.TypeMap[E];
export type Attr<E extends EntityType> = Schema<E>['attributes'];

type Method = 'Create' | 'Read' | 'List' | 'Update' | 'Delete';

export type Response<E extends Entity | Entity[] = Entity> = {
  result: E;
  query: Partial<
    E extends Entity[]
      ? E[0]['attributes']
      : E extends Entity
      ? E['attributes']
      : never
  >;
  method: Method;
  txId: string;
};

export const isApiResponse = (e: any): e is Response =>
  isObject(e) &&
  isObject(e.result) &&
  typeof e.result.id === 'string' &&
  typeof e.method === 'string';

const ec = (entityType: EntityType) =>
  rivalApiSdkJs.instance().entityClient(entityTypeToEntityTypeKey(entityType));

export const create = <E extends EntityType>(entityType: E) => <Q>(query: Q) =>
  liftSys<Response<Schema<E>>>((r) => {
    r.logger(
      `Create: ${entityTypeToEntityTypeKey(entityType)} ${JSON.stringify(
        query
      )}`
    )();
    const tx = ec(entityType).create(query) as Transaction<Schema<E>>;
    return tx.getPromise().then((result) => ({
      result,
      query,
      method: 'Create',
      txId: tx.getId(),
    }));
  });

export const clone = <E extends EntityType>(entityType: E) => <Q>(query: Q) =>
  liftSys<Response<Schema<E>>>((r) => {
    r.logger(
      `Clone: ${entityTypeToEntityTypeKey(entityType)} ${JSON.stringify(query)}`
    )();
    const tx = ec(entityType).clone(query) as Transaction<Schema<E>>;
    return tx.getPromise().then((result) => ({
      result,
      query,
      method: 'Create',
      txId: tx.getId(),
    }));
  });

export const list = <E extends EntityType>(entityType: E) => <Q>(query: Q) =>
  liftSys<Response<Schema<E>[]>>((r) => {
    r.logger(
      `Query: ${entityTypeToEntityTypeKey(entityType)} ${JSON.stringify(query)}`
    )();
    const tx = ec(entityType).list(query as any) as Transaction<Schema<E>[]>;
    return tx.getPromise().then((result) => ({
      result,
      query,
      method: 'List',
      txId: tx.getId(),
    }));
  });

export const update = <E extends EntityType>(entityType: E, id: string) => <Q>(
  query: Q
) =>
  liftSys<Response<Schema<E>>>((r) => {
    r.logger(
      `Update: ${entityTypeToEntityTypeKey(entityType)} ${id} ${JSON.stringify(
        query
      )}`
    )();
    const tx = ec(entityType).update({ id, attributes: query }) as Transaction<
      Schema<E>
    >;
    return tx.getPromise().then((result) => ({
      result,
      query,
      method: 'Update',
      txId: tx.getId(),
    }));
  });

export const upload = <E extends EntityType>(
  entityType: E,
  file: ArrayBuffer | Buffer | File,
  headers: Record<string, any>
) => <Q>(query: Q) =>
  liftSys<Response<Schema<E>>>((r) => {
    r.logger(
      `Upload: ${entityTypeToEntityTypeKey(entityType)} Query: ${JSON.stringify(
        query
      )} Headers: ${JSON.stringify(headers)}`
    )();
    return rivalApiSdkJs
      .instance()
      .getUploadClient(entityType)
      .upload(file, query, headers as any)
      .then((result) =>
        (result.attributes as IUploadEntity).status !== 'VALID'
          ? Promise.reject(
              JSON.stringify(
                (result.attributes as IUploadEntity).errors,
                null,
                2
              )
            )
          : {
              result,
              query,
              method: 'Create',
              txId: (result.attributes as any).transactionId,
            }
      );
  });

export const poll = <E extends EntityType, A extends Schema<E>[]>(
  entityType: E,
  until: Refinement<Schema<E>[], A>
) => <Q>(query: Q) =>
  mkProc<Response<A>>((r) => () =>
    new Promise((resolve) => {
      const etk = entityTypeToEntityTypeKey(entityType);

      let txId: string | undefined;

      const unbind = () => {
        stream.off('data', onStreamData as any);
        stream.off('error', makeError);
        clearInterval(interval);
        clearInterval(monitorTerminateSignal);
      };

      const makeError = (error?: unknown, preempt = false) => {
        unbind();
        resolve(E.left(preempt ? mkPreempt() : mkExogenousError(error)));
      };

      const makeSuccess = (result: A) => {
        unbind();
        resolve(
          E.right({
            result,
            query,
            method: 'List',
            txId: txId
              ? txId
              : (result?.[0]?.attributes as any).transactionId ?? '',
          })
        );
      };

      const attemptResolution = (result: Schema<E>[]) => {
        r.logger(`Poll: ${etk} ${JSON.stringify(query)}`)();

        if (until(result)) {
          makeSuccess(result);
        }
      };

      const onStreamData = (data: Record<typeof etk, Schema<E>[]>) =>
        attemptResolution(data[etk]);

      const stream = rivalApiSdkJs
        .instance()
        .stream({ [etk]: query as any })
        .on('data', onStreamData as any)
        .on('error', makeError);

      const poll = () => {
        const tx = rivalApiSdkJs
          .instance()
          .entityClient(etk)
          .list(query as any, { noCache: true });
        txId = tx.getId();

        tx.getPromise().then(attemptResolution).catch(makeError);
      };
      const interval = setInterval(poll, 5 * 1000);

      const monitorTerminateSignal = setInterval(() => {
        if (r.shouldPreempt()) {
          makeError(undefined, true);
        }
      }, 1000);
    })
  );
