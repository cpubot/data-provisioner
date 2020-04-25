import { Lazy } from 'fp-ts/lib/function';

import { EvalMap } from './Provision';
import { Proc } from '../core/Proc';

export type Runtime = Readonly<{
  get: <A>(p: Proc<A>) => A;
  toJSON: Lazy<string>;
  getEvalMap: Lazy<EvalMap>;
  toArray: Lazy<[number, unknown][]>;
}>;

export const toArray = (evalMap: EvalMap) => () => Array.from(evalMap);
export const fromArray = (ar: [number, unknown][]) => mkRuntime(new Map(ar));
export const fromJSON = (json: string) => mkRuntime(new Map(JSON.parse(json)));
export const toJSON = (evalMap: EvalMap) => () =>
  JSON.stringify(Array.from(evalMap));

export const mkRuntime = (evalMap: EvalMap): Runtime => ({
  get: (p) => {
    if (!evalMap.has(p.id)) {
      throw new Error(`Given proc was not evaluated: ${JSON.stringify(p)}`);
    }
    return evalMap.get(p.id) as any;
  },
  toJSON: toJSON(evalMap),
  toArray: toArray(evalMap),
  getEvalMap: () => evalMap,
});
