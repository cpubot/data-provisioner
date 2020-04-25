# Data Provisioner

Generally, this package is a framework which facilitates the declaration and sequentialization of a set of lazily evaluated asynchronous processes. It additionally includes affordances which facilitate the persistence and, dually, rehydration of evaluations of those processes.

We also include a set of predefined processes which specialize this generalized abstraction to the semantics of the Rival APIs. As such, this can be used as a framework for declaratively specifying the set of processes required to put a Rival environment into a specific state, as well as evaluating and fulfilling those requirements in a deferred way.

## Motivation

The automation of acceptance tests is a crucial step towards achieving scalable and reliable continuous deployment and integration across software services. Perhaps the trickiest part of authoring automated acceptance tests is ensuring that the environment in which a test is executing exists in a specific state.

This framework aims to do the following:

- Allow developers to express the process for putting an environment into a specific state in a declarative and reuseable way that is decoupled from the execution of that process (thus enabling code sharing between environment state declarations).
- Automate the inversion of environment state provisioning.

## Installation

```
yarn add data-provisioner
```

## Design

This package exposes two core abstractions:

- [Monadic Lazy Processes (`Proc`)](#proc)
  - Facilitates declaration and sequentialization of asynchronous processes.
- [Evaluator](#evaluator)
  - Evaluates lazy processes and provides an interface for accessing, persisting, and rehydrating the data returned by evaluation of those processes.

As well as a set of specialized API processes ([`ApiProc`](#ApiProc)):

- [`create`](#create)
- [`extract`](#extract)
- [`query`](#query)
- [`list`](#query)
- [`update`](#update)
- [`upload`](#upload)
- [`poll`](#poll)
- [`pollUntilNonEmpty`](#pollUntilNonEmpty)
- [`pollFirst`](#pollFirst)
- [`pollFirstUntilNonEmpty`](#pollFirstUntilNonEmpty)
- [`untilEntity`](#untilEntity)
- [`untilHasAttrs`](#untilHasAttrs)
- [`awaitTransaction`](#awaitTransaction)

## `Proc`

[`Proc`](https://github.com/10eTechnology/data-provisioner/blob/master/src/core/Proc.ts#L147) (short for "process") is the "primitive" abstraction upon which all process declarations will be built. It is implemented in terms of [`fp-ts`'s `Monad` typeclass](https://gcanti.github.io/fp-ts/modules/Monad.ts.html), and as such can be manipulated in terms of all of `Monad`'s utilities as well as the [`pipeable`](https://gcanti.github.io/fp-ts/modules/pipeable.ts.html) functions. We also include a set of pre-specified [`Apply`](https://gcanti.github.io/fp-ts/modules/Apply.ts.html) utilities, [`sequenceT`](#sequenceT) and [`sequenceS`](#sequenceS).

The type given to represent a `Proc` is, `Proc<A>`. `Proc` is polymorphic, and accepts a single type parameter, which represents the value to which the `Proc` eventually resolves.

For example:

```typescript
type StringProc = Proc<string>;
```

### Constructing `Proc`s

A set of functions are given to facilitate ad-hoc construction of `Proc`s.

- [`lift`](#lift)
- [`liftFn`](#liftFn)

> See [here for `Lazy`](https://gcanti.github.io/fp-ts/modules/function.ts.html#lazy-interface) — it is used often. Essentially, it is just a type which wraps a value around a nullary function to facilitate delayed execution.

##### `lift`

Lift an arbitrary function which returns a `Promise` into a `Proc` context.

```typescript
type lift = <A>(p: Lazy<Promise<A>>) => Proc<A>;
```

E.g.:

```typescript
import { lift } from 'data-provisioner';

// x :: Proc<number>
const x = lift(() => Promise.resolve(1));
```

##### `liftFn`

Lift an arbitrary function into a `Proc` context.

```typescript
type liftFn = <A>(f: Lazy<A>) => Proc<A>;
```

E.g.:

```typescript
import { liftFn } from 'data-provisioner';

// x :: Proc<number>
const x = liftFn(() => 1);
```

### Manipulating `Proc`s

There are many ways to transform and chain `Proc`s. They'll be organized by typeclass source.

#### `Monad` instance

The `Proc` Monad instance can be imported directly and used to perform monadic actions on any `Proc`.

- [`of`](#of)
- [`ap`](#ap)
- [`map`](#map)
- [`chain`](#chain)

##### `of`

Lift a value into a `Proc` context.

```typescript
type of = <A>(a: A) => Proc<A>;
```

E.g.:

```typescript
import { proc } from 'data-provisioner';

// x :: Proc<number>
const x = proc.of(1);
```

##### `map`

Given a `Proc` containing type `A` and a mapping function of type `A → B`, return a new `Proc` containing a transformed value of type `B`.

```typescript
type map = <A, B>(fa: Proc<A>, f: (a: A) => B) => Proc<B>;
```

E.g.:

```typescript
import { proc } from 'data-provisioner';

// x :: Proc<number>
const x = proc.of(1);
// y :: Proc<boolean>
const y = proc.map(x, (n) => n % 2 === 0);
```

##### `ap`

Given a `Proc` containing type `A → B` and a `Proc` containing type `A`, return a new `Proc` containing a transformed value of type `B`.

```typescript
type ap = <A, B>(fab: Proc<(a: A) => B>, fa: Proc<A>) => Proc<B>;
```

E.g.:

```typescript
import { proc } from 'data-provisioner';

// f :: Proc<(x: number) => boolean>
const f = proc.of((x: number) => x % 2 === 0);
// y :: Proc<boolean>
const y = proc.ap(f, proc.of(2));
```

##### `chain`

Given a `Proc` containing type `A` and a function of type `A → Proc<B>`, return a new `Proc` containing a transformed value of type `B`.

```typescript
type chain = <A, B>(ma: Proc<A>, f: (a: A) => Proc<B>) => Proc<B>;
```

E.g.:

```typescript
import { proc } from 'data-provisioner';

// x :: Proc<number>
const x = proc.of(2);
// y :: Proc<boolean>
const y = proc.chain(x, (n) => proc.of(n % 2 === 0));
```

> Note that the main difference between [`chain`](#chain) and [`map`](#map) is the fact that the mapping function given to [`chain`](#chain) returns a `Proc`, while the mapping function given to [`map`](#map) returns a primitive value. It may be hard to see the advantage of this, given a trivial example like the above, but the utility will later become clear.

#### `Pipeable` instance

[`fp-ts`'s `Pipeable`](https://gcanti.github.io/fp-ts/modules/pipeable.ts.html) gives a set of handy utilities for free, given a Monad instance, organized in an ergonomic way for specifying sequences of Monadic transformations when used in conjunction with the [`pipe` function](https://gcanti.github.io/fp-ts/modules/pipeable.ts.html#pipe).

The `Pipeable` versions of the previously defined functions generally flip the order of the arguments and separate function application into two separate unary functions such that the focus is on the series of transformations and not the `Proc` instances themselves.

E.g.:

```typescript
// Non-pipeable
type map = <A, B>(fa: Proc<A>, f: (a: A) => B) => Proc<B>;
```

```typescript
// Pipeable
type map = <A, B>(f: (a: A) => B) => (fa: Proc<A>) => Proc<B>;
```

- [`map`](#map-pipeable)
- [`ap`](#ap-pipeable)
- [`apFirst`](#apFirst-pipeable)
- [`apSecond`](#apSecond-pipeable)
- [`chain`](#chain-pipeable)
- [`chainFirst`](#chainFirst-pipeable)
- [`flatten`](#flatten-pipeable)

##### `map` (`Pipeable`)

Pipeable version of the previously defined semantics of [`map`](#map).

```typescript
type map = <A, B>(f: (a: A) => B) => (fa: Proc<A>) => Proc<B>;
```

E.g.:

```typescript
import { pipe } from 'fp-ts/lib/pipeable';
import { proc, map } from 'data-provisioner';

// x :: Proc<boolean>
const x = pipe(
  proc.of(3),
  map((n) => n % 2 === 0)
);

// y :: Proc<'true' | 'false'>
const y = pipe(
  proc.of('hello world'),
  map((s) => s.length),
  map((n) => n % 2 === 0),
  map((b) => (b ? 'true' : 'false'))
);
```

##### `ap` (`Pipeable`)

Pipeable version of the previously defined semantics of [`ap`](#ap).

```typescript
type ap = <A>(fa: Proc<A>) => <B>(fab: Proc<(a: A) => B>) => Proc<B>;
```

E.g.:

```typescript
import { pipe } from 'fp-ts/lib/pipeable';
import { proc, ap } from 'data-provisioner';

// x :: Proc<boolean>
const x = pipe(
  proc.of((n: number) => n % 2 === 0),
  ap(proc.of(3))
);
```

##### `apFirst` (`Pipeable`)

Given two `Proc`s, execute both and return the result of the first one. Useful for executing two effects (e.g. network requests) in parallel while only being interested in the return value of the first.

```typescript
const apFirst: <B>(fb: Proc<B>) => <A>(fa: Proc<A>) => Proc<A>;
```

E.g.:

```typescript
import { pipe } from 'fp-ts/lib/pipeable';
import { proc, apFirst } from 'data-provisioner';

// x :: Proc<3>
const x = pipe(proc.of(3 as const), apFirst(proc.of('hello world')));
```

##### `apSecond` (`Pipeable`)

Given two `Proc`s, execute both and return the result of the second one. Useful for executing two effects (e.g. network requests) in parallel while only being interested in the return value of the second.

```typescript
type apSecond = <B>(fb: Proc<B>) => <A>(fa: Proc<A>) => Proc<B>;
```

E.g.:

```typescript
import { pipe } from 'fp-ts/lib/pipeable';
import { proc, apSecond } from 'data-provisioner';

// x :: Proc<'hello world'>
const x = pipe(proc.of(3), apSecond(proc.of('hello world' as const)));
```

##### `chain` (`Pipeable`)

Pipeable version of the previously defined semantics of [`chain`](#chain).

```typescript
type chain = <A, B>(f: (a: A) => Proc<B>) => (ma: Proc<A>) => Proc<A>;
```

E.g.:

```typescript
import { pipe } from 'fp-ts/lib/pipeable';
import { proc, chain } from 'data-provisioner';

// x :: Proc<'true' | 'false'>
const x = pipe(
  proc.of('hello world'),
  chain((s) => proc.of(s.length)),
  chain((n) => proc.of(n % 2 === 0)),
  chain((b) => proc.of(b ? 'true' : 'false'))
);
```

##### `chainFirst` (`Pipeable`)

Similar to [`apFirst`](#apFirst-pipeable), but accepts a _function which returns a `Proc`_ rather than a `Proc` itself. Useful for _sequencing_ (i.e. one effect depends on the result of the other) two effects (e.g. network requests) while only being interested in the return value of the first.

```typescript
type chainFirst = <A, B>(f: (a: A) => Proc<B>) => (ma: Proc<A>) => Proc<A>;
```

E.g.:

```typescript
import { pipe } from 'fp-ts/lib/pipeable';
import { proc, chain, chainFirst } from 'data-provisioner';

// x :: Proc<false>
const x = pipe(
  proc.of(3 as const),
  chainFirst((n) => proc.of(n + 1)),
  // Result of above^ is ignored, but still executed.
  // `n` = 3 in this function.
  chain((n) => proc.of(n % 2 === 0))
);
```

##### `flatten` (`Pipeable`)

Extracts a nested `Proc` into a single layered `Proc`.

```typescript
type flatten = <A>(mma: Proc<Proc<A>>) => Proc<A>;
```

E.g.:

```typescript
import { proc, flatten } from 'data-provisioner';

// x :: Proc<Proc<number>>
const x = proc.of(proc.of(5));
// y :: Proc<number>
const y = flatten(x);
```

```typescript
import { pipe } from 'fp-ts/lib/pipeable';
import { proc, flatten } from 'data-provisioner';

// x :: Proc<boolean>
const x = pipe(
  proc.of(3),
  map((n) => proc.of(n % 2 === 0)),
  flatten
  // ^^ using `chain` would avoid the need to
  // `flatten`, but this is still possible.
);
```

#### `Apply` instance

`Apply` affords two functions which facilitate parallel execution of `Proc`s. This is quite handy when wanting to execute multiple `Proc`s in parallel and aggregate their results.

- [`sequenceT`](#sequenceT)
- [`sequenceS`](#sequenceS)

##### `sequenceT`

Given `n` `Proc`s, return a new `Proc` containing an `n` length _tuple_ (hence `T` in `sequenceT`) whose values correspond to each given `Proc`.

```typescript
import { proc, sequenceT } from 'data-provisioner';

// x :: Proc<[number, string]>
const x = sequenceT(proc.of(3), proc.of('hello world'));

proc.map(x, ([num, str]) => {
  // ...
});
```

`sequenceT` is _variadic_.

```typescript
import { proc, sequenceT } from 'data-provisioner';

// x :: Proc<[number, string, boolean]>
const x = sequenceT(proc.of(3), proc.of('hello world'), proc.of(true));

proc.map(x, ([num, str, bool]) => {
  // ...
});
```

##### `sequenceS`

Nearly the same semantics as `sequenceT`, but operating on records (or "structs", hence in `S` `sequenceS`).

```typescript
import { proc, sequenceS } from 'data-provisioner';

// x :: Proc<{ magicNumber: number; greeting: string; }>
const x = sequenceS({
  magicNumber: proc.of(3),
  greeting: proc.of('Hello world'),
});

proc.map(x, ({ magicNumber, greeting }) => {
  // ...
});
```

## `ApiProc`

As mentioned at the beginning of this README, this package includes a set of `Proc`s specialized to interacting with the Rival APIs. The type exposed to encapsulate these types of `Proc`s is `ApiProc`.

All the previously described machinery works on `ApiProc`s, as they're just still just `Proc`s under the hood.

`ApiProc` is not fully polymorphic like the `Proc` type — the type parameter associated to `ApiProc` must extend [`ts-api-types`'s `Entity` interface](https://github.com/10eTechnology/ts-api-types/blob/master/types/Entity.ts).

For example:

```typescript
import { EntitySchemas as ES } from 'ts-api-types';
import { ApiProc } from 'data-provisioner';

type EventProc = ApiProc<ES.Event>;

// Type Error
type X = ApiProc<string>;
```

Under the hood, `ApiProc` is just syntactic sugar on top of the `Proc` type, which includes additional parameters that are relevant to API responses.

Here is the full definition of `ApiProc`.

```typescript
type Method = 'Create' | 'Read' | 'List' | 'Update' | 'Delete';

type Response<E extends Entity | Entity[] = Entity> = {
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

type ApiProc<
  E extends Entity | NonEmptyArray.NonEmptyArray<Entity> = Entity
> = Proc<Api.Response<E>>;
```

Given, the previous example:

```typescript
type EventProc = ApiProc<ES.Event>;
```

The expanded type is:

```typescript
type EventProc = {
  result: ES.Event;
  query: Partial<ES.Event['attributes']>;
  method: Method;
  txId: string;
};
```

### Predefined `ApiProc`s

- [`create`](#create)
- [`extract`](#extract)
- [`query`](#query)
- [`list`](#query)
- [`update`](#update)
- [`upload`](#upload)
- [`poll`](#poll)
- [`pollUntilNonEmpty`](#pollUntilNonEmpty)
- [`pollFirst`](#pollFirst)
- [`pollFirstUntilNonEmpty`](#pollFirstUntilNonEmpty)
- [`untilEntity`](#untilEntity)
- [`untilHasAttrs`](#untilHasAttrs)
- [`awaitTransaction`](#awaitTransaction)

### `ApiProc`s which accept queries

Many of the above listed `ApiProc`s accept queries. Each that does includes some additional syntactic sugar which allows embedding `Proc`s into the query object. The type that encapsulates this type of query is called `QueryAttributes`. It will be referenced often.

#### `create`

Given an `EntityType` and a query, send a create request to the API.

```typescript
type create = <E extends EntityType>(
  entityType: E,
  query: QueryAttributes<E>
) => ApiProc<ES.TypeMap[E]>;
```

E.g.:

```typescript
import { EntityType } from 'ts-api-types';
import { create } from 'data-provisioner';

const event = create(EntityType.Event, { name: 'My Event' });
```

#### `extract`

Given an `ApiProc` and an optional mapping function, return a new `Proc` which resolves with the return value of the mapping function. If a mapping function is not provided, it will return the `id` of the entity in the `ApiProc`.

This is useful for referencing the entities associated to `ApiProc`s within the query of another `ApiProc`.

```typescript
function extract<E extends Entity | NonEmptyArray.NonEmptyArray<Entity>>(
  p: ApiProc<E>
): Proc<string>;
function extract<E extends Entity | NonEmptyArray.NonEmptyArray<Entity>, A>(
  p: ApiProc<E>,
  f: (e: E) => A
): Proc<A>;
```

E.g.:

```typescript
import { EntityType } from 'ts-api-types';
import { create, query, extract } from 'data-provisioner';
import faker from faker;

const venue = query(EntityType.Venue, { name: 'Paramount Theatre' });

const mCT = query(EntityType.ManifestConfigurationTemplate, {
  venueId: extract(venue),
});

const event = create(EntityType.Event, {
  manifestConfigurationTemplateId: extract(mCT),
  name: 'My Event',
  eventDatetime: {
    timezone: extract(venue, (v) => v.attributes.timezone),
    datetimeUtc: moment(faker.date.future()).toISOString(),
  },
});
```

#### `query`

Given an `EntityType` and a query, send a list request to the API, returning the first result. If the result is empty, an exception will be thrown.

```typescript
type query = <E extends EntityType>(
  entityType: E,
  query: QueryAttributes<E>
) => ApiProc<ES.TypeMap[E]>;
```

E.g.:

```typescript
import { EntityType } from 'ts-api-types';
import { query } from 'data-provisioner';

const venue = query(EntityType.Venue, { name: 'Paramount Theatre' });
```

#### `list`

Given an `EntityType` and a query, send a list request to the API, returning the entire result. If the result is empty, an exception will be thrown.

```typescript
type list = <E extends EntityType>(
  entityType: E,
  query: QueryAttributes<E>
) => ApiProc<NonEmptyArray<ES.TypeMap[E]>>;
```

E.g.:

```typescript
import { EntityType } from 'ts-api-types';
import { list } from 'data-provisioner';

const productDistributions = list(EntityType.ProductDistribution, {
  active: true,
});
```

#### `update`

Given an `EntityType`, an entity ID, and a query, send an update request to the API, returning the updated entity from the API.

```typescript
type update = <E extends EntityType>(
  entityType: E,
  idProc: Proc<string> | string,
  query: QueryAttributes<E>
) => ApiProc<ES.TypeMap[E]>;
```

E.g.:

```typescript
import { EntityType } from 'ts-api-types';
import { update, query, extract } from 'data-provisioner';

const fanProfile = query(EntityType.FanProfile, { name: 'Bob' });
const fanProfileUpdate = update(EntityType.FanProfile, extract(fanProfile), {
  name: 'Hello',
});
```

#### `upload`

Given an `EntityType`, a file, a query, and optional headers, send an upload request to the API, returning the associated entity from the API.

```typescript
type upload = <E extends EntityType>(
  entityType: E,
  file: Buffer | ArrayBuffer | File,
  query: QueryAttributes<E>,
  headers?: Record<string, any>
) => ApiProc<ES.TypeMap[E]>;
```

E.g.:

```typescript
import { EntityType } from 'ts-api-types';
import { upload, create, query, update, extract } from 'data-provisioner';

const event = create(EntityType.Event, {
  name: 'My Event',
});

const printTemplate = query(EntityType.PrintTemplate, {
  eventManifestId: extract(event, (e) => e.attributes.eventManifestId),
  cardType: 'INVENTORY',
  entitlementType: 'SEATING',
});

const printTemplateFile = upload(
  EntityType.PrintTemplateFile,
  new File(['some file contents'], 'file.txt'),
  { fileName: 'file.txt' },
  {
    'Content-Type': 'text/plain',
  }
);

const printTemplateUpdate = update(
  EntityType.PrintTemplate,
  extract(printTemplate),
  { printTemplateFileId: extract(printTemplateFile) }
);
```

#### `poll`

Given an `EntityType`, a query, and a [`Refinement`](https://gcanti.github.io/fp-ts/modules/function.ts.html#refinement-interface), periodically send a list request to the API, until the refinement predicate returns `true`. Note this function _will not_ throw an exception when results are empty.

```typescript
type poll = <E extends EntityType, A extends ES.TypeMap[E][]>(
  entityType: E,
  query: QueryAttributes<E>,
  until: Refinement<ES.TypeMap[E][], A>
) => ApiProc<A>;
```

E.g.:

```typescript
import { EntityType, EntitySchemas as ES } from 'ts-api-types';
import { create, poll, extract } from 'data-provisioner';
import * as O from 'fp-ts/lib/Option';
import * as NonEmptyArray from 'fp-ts/lib/NonEmptyArray';

const event = create(EntityType.Event, {
  name: 'My Event',
});

// Poll for print templates until some exist
const printTemplates = poll(
  EntityType.PrintTemplate,
  {
    eventManifestId: extract(event, (e) => e.attributes.eventManifestId),
    cardType: 'INVENTORY',
  },
  (ar): ar is NonEmptyArray.NonEmptyArray<ES.PrintTemplate> =>
    O.isSome(NonEmptyArray.fromArray(ar))
);
```

#### `pollUntilNonEmpty`

Like [`poll`](#poll), but pre-configured with a nonEmpty refinement.

```typescript
type pollUntilNonEmpty = <E extends EntityType>(
  entityType: E,
  query: QueryAttributes<E>
) => ApiProc<NonEmptyArray<ES.TypeMap[E]>>;
```

E.g.:

```typescript
import { EntityType } from 'ts-api-types';
import { create, pollUntilNonEmpty, extract } from 'data-provisioner';

const event = create(EntityType.Event, {
  name: 'My Event',
});

// Poll for print templates until some exist
const printTemplates = pollUntilNonEmpty(EntityType.PrintTemplate, {
  eventManifestId: extract(event, (e) => e.attributes.eventManifestId),
  cardType: 'INVENTORY',
});
```

#### `pollFirst`

Like [`poll`](#poll), but pre-configured with a nonEmpty refinement on the list, and executing an additional refinement on the first result of that list.

```typescript
type pollFirst = <E extends EntityType, A extends ES.TypeMap[E]>(
  entityType: E,
  query: QueryAttributes<E>,
  until: Refinement<ES.TypeMap[E], A>
) => ApiProc<A>;
```

E.g.:

```typescript
import { EntityType, EntitySchemas as ES } from 'ts-api-types';
import { create, pollFirst, extract } from 'data-provisioner';

const event = create(EntityType.Event, {
  name: 'My Event',
});

const eventWithEventManifestId = pollFirst(
  EntityType.Event,
  {
    id: extract(event),
  },
  (e): e is ES.Event & { attributes: { eventManifestId: string } } =>
    e.attributes.eventManifestId !== null &&
    e.attributes.eventManifestId !== undefined
);
```

With [`chain`](#chain-Pipeable):

```typescript
import { EntityType, EntitySchemas as ES } from 'ts-api-types';
import { create, pollFirst, extract, chain } from 'data-provisioner';
import { pipe } from 'fp-ts/lib/pipeable';

const event = pipe(
  create(EntityType.Event, {
    name: 'My Event',
  }),
  chain(({ result: event }) =>
    pollFirst(
      EntityType.Event,
      {
        id: event.id,
      },
      (e): e is ES.Event & { attributes: { eventManifestId: string } } =>
        e.attributes.eventManifestId !== null &&
        e.attributes.eventManifestId !== undefined
    )
  )
);
```

#### `pollFirstUntilNonEmpty`

Like [`pollFirst`](#pollFirst) and [`pollUntilNonEmpty`](#pollUntilNonEmpty), but simply returns the first result of the query, when the list becomes non-empty.

```typescript
type pollFirstUntilNonEmpty = <E extends EntityType>(
  entityType: E,
  query: QueryAttributes<E>
) => ApiProc<ES.TypeMap[E]>;
```

E.g.:

```typescript
import { EntityType } from 'ts-api-types';
import { create, pollFirstUntilNonEmpty, extract } from 'data-provisioner';

const event = create(EntityType.Event, {
  name: 'My Event',
});

// Poll for inventory seating templates until one exists, and return it.
const printTemplates = pollFirstUntilNonEmpty(EntityType.PrintTemplate, {
  eventManifestId: extract(event, (e) => e.attributes.eventManifestId),
  cardType: 'INVENTORY',
  entitlementType: 'SEATING',
});
```

#### `untilEntity`

Like [`pollFirst`](#pollFirst), but curried with an `ApiProc` as input such that it can be used in a `pipe` context without having to manually construct the call to `pollFirst`.

```typescript
type untilEntity = <E extends Entity, A extends E>(
  until: Refinement<E, A>
) => (proc: ApiProc<E>) => ApiProc<A>;
```

E.g.:

```typescript
import { EntityType, EntitySchemas as ES } from 'ts-api-types';
import { create, untilEntity } from 'data-provisioner';
import { pipe } from 'fp-ts/lib/pipeable';

const event = pipe(
  create(EntityType.Event, {
    name: 'My Event',
  }),
  untilEntity(
    (e): e is ES.Event & { attributes: { eventManifestId: string } } =>
      e.attributes.eventManifestId !== null &&
      e.attributes.eventManifestId !== undefined
  )
);
```

#### `untilHasAttrs`

Like [`untilHasAttrs`](#untilHasAttrs), but pre-configured with a refinement that checks that the given attributes are neither `null` nor `undefined`.

```typescript
type untilHasAttrs = <E extends Entity, K extends (keyof E['attributes'])[]>(
  ks: K
) => (proc: ApiProc<E>) => ApiProc<E>;
```

E.g.:

```typescript
import { EntityType, EntitySchemas as ES } from 'ts-api-types';
import { create, untilHasAttrs } from 'data-provisioner';
import { pipe } from 'fp-ts/lib/pipeable';

const event = pipe(
  create(EntityType.Event, {
    name: 'My Event',
  }),
  untilHasAttrs([
    'eventManifestId',
    'priceConfigurationId',
    'manifestCategorySetId',
  ])
);
```

#### `awaitTransaction`

Accepts an optional configuration, and monitors the pub/sub channel for messages containing the transaction used to create a given `Proc`.

```typescript
type awaitTransaction = ({
  timeout = 30000,
  rejectOnTimeout = true,
}:
  | {
      timeout?: number;
      rejectOnTimeout?: boolean;
    }
  | undefined) => <E extends Entity | NonEmptyArray.NonEmptyArray<Entity>>(
  proc: ApiProc<E>
) => ApiProc<E>;
```

E.g.:

```typescript
import { awaitTransaction, update } from 'data-provisioner';
import { pipe } from 'fp-ts/lib/pipeable';

const seatTransform = pipe(
  update(EntityType.SeatTransform, 'aaaa-aaaa-aaaa-aaaa', {
    // ...
  }),
  awaitTransaction({ timeout: 60000 })
);
```

## Evaluator

Again, since the `Proc` themselves are lazy and thus not implicitly executed, we need a way to actually invoke them. The function that does this is called [`provision`](#provision).

### `provision`

```typescript
type provision = (
  logger: (s: string) => IO<void>
) => (inputTree: Tree<Proc<unknown>>) => Promise<Either<unknown, Runtime>>;
```

Let's break that down.

#### `logger`

```typescript
(s: string) => IO<void>
```

Most of the `ApiProc`s will output some kind of log entry.

> See [here](https://gcanti.github.io/fp-ts/modules/IO.ts.html) for information on the `IO` type — its type signature is analogous to that of [`Lazy`](https://gcanti.github.io/fp-ts/modules/function.ts.html#lazy-interface).

Simplest `logger` example looks something like the following:

```typescript
const logger = (msg: string) => () => console.log(msg);
```

`fp-ts` [exports a function that does exactly this](https://gcanti.github.io/fp-ts/modules/Console.ts.html#log).

```typescript
import { log } from 'fp-ts/lib/Console';
```

#### `inputTree`

```typescript
inputTree: Tree<Proc<unknown>>
```

Provision accepts a `Tree` of `Proc`s (`Tree<Proc<unknown>>`). The order and sequence from the perspective of `provision` is irrelevant, as the proper sequence will be encoded into the `Proc`s by definition.

`Tree` is defined as:

```typescript
type Tree<A> = A | unknown | Tree<A>[] | { [key: string]: Tree<A> };
```

These are all valid trees:

```typescript
import { proc } from 'data-provisioner';

const tree1 = [proc.of(3)];

const tree2 = proc.of('hello world');

const tree3 = [proc.of(3), { someKey: proc.of('hello world') }];

const tree4 = { x: [proc.of(3), { y: { z: proc.of('hello world') } }] };
```

#### Return type

```typescript
Promise<E.Either<unknown, Runtime>>
```

A `Promise` containing either some failure message or a [`runtime`](#runtime) associated with the given `Tree`. If the evaluation fails, any invertible steps will be implicitly inverted.

E.g.:

```typescript
import { proc, provision } from 'data-provisioner';
import { log } from 'fp-ts/lib/Console';

const proc1 = proc.of(3);
const proc2 = proc.of('hello world');
const procTree = [proc1, proc2];

const maybeRuntime = await provision(log)(procTree);
if (maybeRuntime._tag === 'Left') {
  console.log(`There was an error, ${maybeRuntime.left}`);
  return;
}

const runtime = maybeRuntime.right;
const x = runtime.get(proc2); // -> 'hello world'
// ...
```

### `Runtime`

A successful provision returns a `Runtime`. `Runtime` is the interface through which one will extract results from the evaluation of a `Proc` Tree.

```typescript
type Runtime = {
  get: <A>(p: Proc<A>) => A;
  toJSON: Lazy<string>;
  getEvalMap: Lazy<EvalMap>;
  toArray: Lazy<[number, unknown][]>;
};
```

In addition to `get`, which retrieves the evaluated value for a given `Proc`, there's a few other methods available to aid in persisting the runtime for later rehydration.

There are some associated helpers exported to facilitate the rehydration itself.

```typescript
import { fromJSON, fromArray } from 'data-provisioner';

// ... assume loaded JSON from previous toJSON call
const runtime = fromJSON(json);

// or
const runtime = fromArray(JSON.parse(json));
```

### `teardown`

```typescript
type teardown = (
  logger: (s: string) => IO<void>
) => (runtime: Runtime) => Promise<Either<unknown, unknown[]>>;
```

Given a `logger`, and a `runtime` from previous provisioning, invert any evaluation results which are invertible.

```typescript
import { proc, provision, teardown } from 'data-provisioner';
import { log } from 'fp-ts/lib/Console';

const proc1 = proc.of(3);
const proc2 = proc.of('hello world');
const procTree = [proc1, proc2];

const maybeRuntime = await provision(log)(procTree);
if (maybeRuntime._tag === 'Left') {
  console.log(`There was an error, ${maybeRuntime.left}`);
  return;
}

const runtime = maybeRuntime.right;
const x = runtime.get(proc2); // -> 'hello world'
// ... do useful stuff

const teardownResult = await teardown(log)(runtime);
if (teardownResult._tag === 'Left') {
  console.log(`There was an error on teardown! ${teardownResult.left}`);
  return;
}
console.log('teardown successful');
```
