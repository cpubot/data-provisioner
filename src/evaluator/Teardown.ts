import * as TE from 'fp-ts/lib/TaskEither';
import { identity } from 'fp-ts/lib/function';
import { array } from 'fp-ts/lib/Array';
import * as E from 'fp-ts/lib/Either';
import * as O from 'fp-ts/lib/Option';

import rivalApiSdkJs from 'rival-api-sdk-js';
import { snakeCaseToEntityTypeKey } from 'ts-api-types';

import { Runtime } from './Runtime';
import * as Api from '../lib/Api';
import { Value, Sys, isPreempt } from '../core/Proc';

export const teardown = (logger: Sys['logger']) => async (runtime: Runtime) => {
  const dedupe = new Set();
  return array.sequence(E.either)(
    await Promise.all(
      (Array.from(runtime.getEvalMap().entries())
        .filter(([, ev]) => {
          if (Api.isApiResponse(ev) && ev.method === 'Create') {
            if (dedupe.has(ev.result.id)) {
              return false;
            }
            dedupe.add(ev.result.id);
            return true;
          }
          return false;
        })
        .sort(([idA], [idB]) => idB - idA) as [number, Api.Response][]).map(
        ([, c]) => {
          const etk = snakeCaseToEntityTypeKey(c.result.type);
          logger(`Delete: ${etk} ${JSON.stringify({ id: c.result.id })}`)();

          return TE.tryCatch(
            () =>
              rivalApiSdkJs
                .instance()
                .entityClient(etk)
                .delete(c.result.id)
                .getPromise(),
            identity
          )();
        }
      )
    )
  );
};

export const teardownPartial = (logger: Sys['logger']) => async (
  context: Map<number, Value<unknown>>
) => {
  const invertables: Map<string, readonly [number, Api.Response]> = new Map();
  for (const [id, value] of context.entries()) {
    if (E.isRight(value)) {
      if (Api.isApiResponse(value.right) && value.right.method === 'Create') {
        invertables.set(value.right.result.id, [id, value.right]);
      }
      continue;
    }

    if (isPreempt(value.left)) {
      if (O.isNone(value.left.result)) {
        continue;
      }
      if (
        Api.isApiResponse(value.left.result.value.right) &&
        value.left.result.value.right.method === 'Create'
      ) {
        invertables.set(value.left.result.value.right.result.id, [
          id,
          value.left.result.value.right,
        ]);
      }
    }
  }

  return Promise.all(
    Array.from(invertables)
      .sort(([, [idA]], [, [idB]]) => idB - idA)
      .map(([, [, c]]) => {
        const etk = snakeCaseToEntityTypeKey(c.result.type);
        logger(`Delete: ${etk} ${JSON.stringify({ id: c.result.id })}`)();

        return TE.tryCatch(
          () =>
            rivalApiSdkJs
              .instance()
              .entityClient(snakeCaseToEntityTypeKey(c.result.type))
              .delete(c.result.id)
              .getPromise(),
          identity
        )();
      })
  );
};
