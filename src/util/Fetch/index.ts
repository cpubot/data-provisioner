import rivalApiSdkJs, {
  EntityType,
  EntitySchemas as ES,
  entityTypeToEntityTypeKey,
  Transaction,
} from 'rival-api-sdk-js';

const ec = (e: EntityType) =>
  rivalApiSdkJs.instance().entityClient(entityTypeToEntityTypeKey(e));

type Query<E extends EntityType> = Record<string, any> &
  Partial<ES.TypeMap[E]['attributes']>;

export const list = <E extends EntityType>(e: E) => (query: Query<E>) =>
  (ec(e).list(query as any) as Transaction<ES.TypeMap[E][]>).getPromise();

export const first = <E extends EntityType>(e: E) => (query: Query<E>) =>
  list(e)(query).then(r => {
    if (r.length === 0) {
      throw new Error(
        `first: Result for ${EntityType[e]}: ${JSON.stringify(
          query
        )} was empty.`
      );
    }

    return r[0];
  });
