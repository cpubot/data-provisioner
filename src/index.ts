export {
  Proc,
  isProc,
  proc,
  lift,
  liftFn,
  liftSys,
  liftFnSys,
  getSemigroup,
  getMonoid,
  map,
  chain,
  chainFirst,
  flatten,
  ap,
  apFirst,
  apSecond,
  sequenceT,
  sequenceS,
} from './core';

export {
  ApiProc,
  create,
  list,
  first,
  last,
  query,
  update,
  upload,
  poll,
  pollUntilNonEmpty,
  pollFirst,
  pollFirstUntilNonEmpty,
  untilEntity,
  untilHasAttrs,
  extract,
  awaitTransaction,
} from './lib';

export {
  Runtime,
  provision,
  teardown,
  fromArray,
  fromJSON,
  toJSON,
  mkRuntime,
} from './Evaluator';

export { Tree, collect, mapTree, flat } from './util';

import { Tree } from './util';
import { Proc } from './core/Proc';

export type Recipe = Tree<Proc<unknown>>;
