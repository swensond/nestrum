/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

// Core Svelte type shims — always shipped into the project cache.
//
// The two reference directives above forcibly include the DOM lib
// regardless of the user's `compilerOptions.lib` setting. Rationale:
// Svelte components always run in a browser-like context (real DOM
// or a minimal polyfill), and the emit references DOM types via
// bind:this handlers, event handlers, `svelteHTML.createElement`
// paths, etc. Projects that narrow `lib` to exotic values like
// `["WebWorker"]` (seen in service-worker-only apps) would otherwise
// lose access to HTMLElement/document/alert/etc. at type-check time,
// firing TS2304 "Cannot find name" on every element binding. Upstream
// svelte-check takes the same approach in svelte-jsx-v4.d.ts; mirror it.
//
//
// Holds the Svelte 5 rune ambients ($state, $derived, $effect, $props,
// $bindable, $inspect, $host) plus the helper types emit references
// (__svn_store_get, __svn_type_ref). These have no equivalent in the
// real `svelte` npm package — runes are compiler macros, and the
// helpers are our private contract with the emit crate — so this file
// is written to the cache on every check, regardless of whether the
// user has `svelte` installed in node_modules.
//
// The `@@FALLBACK_BEGIN@@` … `@@FALLBACK_END@@` block below holds
// the `declare module 'svelte/*'` stand-ins for the real package.
// The runtime (typecheck/src/lib.rs) strips the whole block before
// writing the shim into the cache WHEN a real svelte install is
// reachable from the workspace. Without that strip, the fallback
// declarations would shadow the richer real types (e.g.
// `HTMLAnchorAttributes` from svelte/elements) and produce
// false-positive TS2305 errors on user code that uses names the
// fallback doesn't enumerate.

// Runes are declared at top level (script mode) rather than inside
// `declare global` because this file is a `.d.ts` script (no top-level
// imports/exports), so its declarations are already global.

// ---------- helpers used by emit ----------

/** Minimal shape of a Svelte store. */
type __SvnStore<T> = { subscribe: (run: (value: T) => any, invalidate?: any) => any };

/**
 * Value of a store, for the `$store` auto-subscription declaration
 * emit appends after the store's own declaration:
 *   `;let $foo = __svn_store_get(foo);`
 *
 * Same overloads as upstream's `__sveltets_2_store_get`: a store yields
 * its value type; `undefined` / `null` pass through; anything else
 * fails the call — inside the ignore region emit wraps it in, which
 * leaves `$foo` as `any`.
 */
declare function __svn_store_get<T = any>(store: __SvnStore<T>): T;
declare function __svn_store_get<Store extends __SvnStore<any> | undefined | null>(
    store: Store
): Store extends __SvnStore<infer T> ? T : Store;
declare function __sveltets_2_store_get<T = any>(store: __SvnStore<T>): T;
declare function __sveltets_2_store_get<Store extends __SvnStore<any> | undefined | null>(
    store: Store
): Store extends __SvnStore<infer T> ? T : Store;

/**
 * `$$slots`: one `boolean` per slot the template declares, keyed by the
 * slot names passed in (`{ name: '' }`), as upstream's
 * `__sveltets_2_slotsType`.
 */
declare function __svn_slots_type<Slots, Key extends keyof Slots>(slots: Slots): Record<Key, boolean>;
declare function __sveltets_2_slotsType<Slots, Key extends keyof Slots>(slots: Slots): Record<Key, boolean>;

/**
 * Surface a type-only template reference inside the type-check function
 * so TS6196 doesn't fire on `import type { Foo }` that's only used in a
 * `<Component prop={value as Foo} />`-style assertion. The body is a
 * pure type expression — no runtime cost.
 */
declare function __svn_type_ref<T>(): T;

// SVELTE-4-COMPAT: `ConstructorOfATypedSvelteComponent` is the ambient
// name upstream's shims give "any class-form Svelte component". User
// code in mid-migration codebases types props with it
// (`export let icon: ConstructorOfATypedSvelteComponent;`), and it is
// the class-form half of `__svn_ensure_component`'s constraint. Both
// declarations are upstream's, verbatim: the `$$prop_def` /
// `$$events_def` / `$$slot_def` fields are compile-time-only carriers
// of a class component's Props / Events / Slots.
/**
 * Ambient type only used for intellisense, DO NOT USE IN YOUR PROJECT
 */
declare type ATypedSvelteComponent = {
    /**
     * @internal This is for type checking capabilities only
     * and does not exist at runtime. Don't use this property.
     */
    $$prop_def: any;
    /**
     * @internal This is for type checking capabilities only
     * and does not exist at runtime. Don't use this property.
     */
    $$events_def: any;
    /**
     * @internal This is for type checking capabilities only
     * and does not exist at runtime. Don't use this property.
     */
    $$slot_def: any;

    $on(event: string, handler: any): () => void;
};

/**
 * Ambient type only used for intellisense, DO NOT USE IN YOUR PROJECT.
 *
 * If you're looking for the type of a Svelte Component, use `SvelteComponent` and `ComponentType` instead.
 */
declare type ConstructorOfATypedSvelteComponent = new (args: {
    target: any;
    props?: any;
}) => ATypedSvelteComponent;

// SVELTE-4-COMPAT: additive props-type widening for Svelte-4 components.
// A parent's `<Foo on:close={fn}>` is rewritten by our analyze pass to
// `{onclose: fn}` on the child's props object; a parent's
// `<Foo slot="x">` lands as `{slot: "x"}`. Neither key exists on Foo's
// declared Props when Foo uses Svelte-4 `createEventDispatcher` or
// upstream slot syntax. Intersecting `__SvnSvelte4PropsWiden<Props>`
// into the Props type argument of a Svelte-4 component's default
// export silences TS2353 on those keys without opening every
// component to any-prop abuse (only files that trip
// `is_svelte4_component` get the widen).
//
// `Omit<…, keyof P>` is load-bearing: WITHOUT it, a declared prop
// `onChange: (v: string) => void` intersects with the widen's
// `on${string}` signature `(e: CustomEvent<any>) => any`, collapsing
// the union to `never` and rejecting every caller's handler. With
// the Omit, already-declared on* keys pass through unchanged; the
// widen only introduces BRAND-NEW keys (handlers for events the
// component dispatches but doesn't declare as props, like Svelte-4
// `createEventDispatcher` usage).
//
// Handler type is deliberately lax: `CustomEvent<any>` rather than
// `CustomEvent<Detail>` for each specific event name — synthesising
// the exact detail shape from `createEventDispatcher<…>()`
// introspection is a later refinement.
// The handler signature `(e: any) => any` is load-bearing. Narrower
// signatures like `(e: CustomEvent<any>) => any` create an
// index-signature conflict with declared props like
// `onChange: (v: string) => void` — TS reports "Property onChange
// is incompatible with index signature" even when combined via
// `Omit`. Wider values (`any`) avoid the conflict but cause TS7031
// "binding element implicitly has an 'any' type" on destructures
// like `({detail}) => …` because destructuring a raw `any`
// parameter fires implicit-any in strict mode.
//
// `(e: any) => any` threads the needle: the parameter is
// explicitly-`any`-typed, so `({detail})` destructuring
// contextually types `detail: any` (not implicit). And the
// function-to-function assignability check treats `(v: string) =>
// void` as compatible with `(e: any) => any` via bivariance, so the
// index-signature conflict doesn't fire.
// Matches upstream's `__sveltets_2_PropsWithChildren<Props, Slots>`
// shape (svelte-shims-v4.d.ts:258-266) — only adds `children?: any`
// when the component has a default slot. Everything else (class, style,
// slot, on*) must be declared in user Props or users hit TS2353 —
// same strictness as upstream.
//
// Prior version intersected {slot?, class?, style?, children?} +
// {[index: string]: any} unconditionally; ANY non-empty intersection
// contaminated tsgo's assignability check for missing-required-prop
// cases — tsgo reported TS2322 "Type '{}' is not assignable" at the
// top level with the precise TS2741 as a sub-message (observed on
// language-tools/.../test-error/Index.svelte's `<Jsdoc />`). Matching
// upstream's minimal widen lets TS2741 surface directly.
declare type __SvnSvelte4PropsWiden<P> = 'children' extends keyof P
    ? {}
    : { children?: any };

// SVELTE-4-COMPAT: mirrors upstream's `__sveltets_2_PropsWithChildren`
// (svelte-shims-v4.d.ts:258-266) for the consumer-facing constructor /
// callable Props type when a Svelte-4 component has a default slot.
//
// The non-trivial branch: `P extends Record<string, never>` widens to
// `any`. Without that short-circuit, the natural shape
// `Partial<Record<string, never> & { children?: any }> & { children?:
// any }` collapses under TS's intersection rules to a type with a
// `[k: string]?: never` index signature plus an explicit `children?:
// any`. The index signature demands `never` for every string key —
// including `children` after Partial flattens — so a consumer's
// `props: { children: () => …}` fails TS2322 ("not assignable to
// 'Partial<Record<string, never>> & { children?: any }'"). Upstream's
// own comment names this exact trap: "the alternative is non-fixable
// type errors because of the way TypeScript index signatures work
// (they will always take precedence and make an impossible-to-satisfy
// children type)." Hence both upstream and our copy widen to `any`.
//
// `Widened` is the second parameter so emit can pass the
// already-computed `P & __SvnSvelte4PropsWiden<P>` (or, when the child
// uses `$$props`, `P & __SvnSvelte4PropsWiden<P> & __SvnAllProps`)
// directly. Centralising the conditional here keeps emit simple — it
// just emits `__SvnSvelte4SlotedProps<P, P & widen<P>>` for the
// has-default-slot branch.
declare type __SvnSvelte4SlotedProps<P, Widened> = P extends Record<
    string,
    never
>
    ? any
    : Widened & { children?: any };

// Applied CONDITIONALLY at the emit site (intersected into the widen
// only when the child component uses `$$props` / `$$restProps`). Mirror
// of upstream's `SvelteAllProps` (svelte-shims-v4.d.ts:39), which
// upstream applies via `__sveltets_2_with_any(…)` or
// `__sveltets_2_partial_with_any(…)` factory functions when the child's
// `uses$$props` flag is set. Components that DON'T reference those
// identifiers keep strict Props — matching upstream's TS2353 on
// undeclared attrs.
declare type __SvnAllProps = { [index: string]: any };
// `children?: any` mirrors upstream's `__sveltets_2_PropsWithChildren`
// widen (svelte-shims-v4.d.ts:258-266) — lets the consumer-side
// implicit-children emission (`children: () => __svn_snippet_return()`
// on `<Foo>body</Foo>` patterns) type-check against Svelte 4
// components that have `<slot>` usage. Previously we included a
// catch-all `{ [index: string]: any }` which accepted `children` but
// also contaminated tsgo's assignability check — TS2322 top-level
// error fired instead of the precise TS2741 on missing required props
// (observed on language-tools/.../test-error/Index.svelte's
// `<Jsdoc />` vs expected TS2741). Dropping the index sig requires
// users of Svelte 4 components to not pass undeclared attrs — same
// strictness as upstream.

/**
 * Default export of a component that is not a plain Svelte 5
 * `Component`: constructible like a Svelte 4 class and callable like a
 * Svelte 5 function component. Upstream's
 * `__sveltets_2_IsomorphicComponent`, verbatim. The call signature
 * takes the props plus the `$$events` / `$$slots` carriers — only
 * those two when the component declares no props at all.
 */
interface __SvnIsomorphicComponent<
    Props extends Record<string, any> = any,
    Events extends Record<string, any> = any,
    Slots extends Record<string, any> = any,
    Exports = {},
    Bindings = string,
> {
    new (
        options: import('svelte').ComponentConstructorOptions<Props>,
    ): import('svelte').SvelteComponent<Props, Events, Slots> & { $$bindings?: Bindings } & Exports;
    (
        internal: unknown,
        props: Props extends Record<string, never>
            ? { $$events?: Events; $$slots?: Slots }
            : Props & { $$events?: Events; $$slots?: Slots },
    ): Exports & { $set?: any; $on?: any };
    z_$$bindings?: Bindings;
}
type __sveltets_2_IsomorphicComponent<
    Props extends Record<string, any> = any,
    Events extends Record<string, any> = any,
    Slots extends Record<string, any> = any,
    Exports = {},
    Bindings = string,
> = __SvnIsomorphicComponent<Props, Events, Slots, Exports, Bindings>;

/**
 * Props / slots of a legacy JavaScript component as consumers see them.
 * An untyped `export let x = undefined` has type `undefined`, which
 * upstream (`SveltePropsAnyFallback` / `SvelteSlotsAnyFallback`,
 * applied by `__sveltets_2_partial`) widens to `any` so any value can
 * be passed. `__SvnExpand` is upstream's `Expand`, which flattens the
 * result into a plain object type.
 */
type __SvnExpand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;
type __SvnPropsAnyFallback<Props> = {
    [K in keyof Props]: Props[K] extends never ? never : Props[K] extends undefined ? any : Props[K];
};
type __SvnSlotsAnyFallback<Slots> = {
    [K in keyof Slots]: { [S in keyof Slots[K]]: Slots[K][S] extends undefined ? any : Slots[K][S] };
};

// SVELTE-4-COMPAT: `$$Generic<T>` is Svelte 4's pre-Svelte-5-generics-attr
// syntax for declaring a generic type parameter on a component — written
// as `type T = $$Generic<any>`. The syntax has no Svelte 5 equivalent;
// we alias to `any` so the reference resolves and the user's type usage
// downstream type-checks (loosely).
declare type $$Generic<T = any> = T;

// SVELTE-4-COMPAT: `__svn_invalidate(() => expr)` wraps the RHS of a
// reactive declaration (`$: NAME = expr`) in a lazy thunk. The
// purpose is purely type-checking: the thunk body is NEVER invoked,
// so TS's control-flow analysis treats any identifier references
// inside as lazy. That matters when `expr` references a `const`
// function declared LATER in the script — e.g.:
//
//     $: foo = helper(x)
//     const helper = (x: X) => …
//
// Without the wrap, TS fires TS2448 "used before its declaration"
// on `helper` because `$: foo = …` becomes `let foo = helper(x)`
// at source position, and the `const helper` at a later position
// triggers TDZ. With the wrap (`let foo = __svn_invalidate(() =>
// helper(x))`), the reference is inside an uncalled arrow; TDZ
// analysis doesn't apply, and the return type still flows out as
// the inferred `T` of the thunk.
//
// Mirrors upstream svelte2tsx's `__sveltets_2_invalidate` helper.
declare function __svn_invalidate<T>(fn: () => T): T;



























































































// Internal helpers emitted by svelte-check-native into generated `.svelte.ts`
// files. Declared here so the generated code type-checks. The `__svn_*`
// prefix marks them as ours; user code shouldn't touch them.

/**
 * Iterable wrapper for `{#each}` blocks. Mirrors upstream's
 * `__sveltets_2_ensureArray<T extends ArrayLike<unknown> |
 * Iterable<unknown>>(array: T | undefined | null)`
 * (`svelte-shims-v4.d.ts:253-256`). The constraint fires TS2345 on
 * non-arraylike non-iterable expressions (`{#each {}}`,
 * `{#each 1}`); the `T | undefined | null` parameter widening lets
 * `Foo[] | undefined` narrow to `Foo[]` for item typing without
 * losing the runtime null-tolerance.
 */
declare function __svn_each_items<T extends ArrayLike<unknown> | Iterable<unknown>>(
    value: T | undefined | null,
): Iterable<__SvnEachItem<T>>;

/** Resolved item type for `__svn_each_items`. The `0 extends 1 & T` guard preserves `any` (avoids the conditional-type-distribution-collapses-to-unknown trap). */
type __SvnEachItem<T> = 0 extends 1 & T
    ? any
    : T extends ArrayLike<infer U>
        ? U
        : T extends Iterable<infer U>
            ? U
            : never;

/**
 * Value-level item of an `{#each}` source, used to resolve a binding
 * exposed through a `<slot>`. Same signature as upstream's
 * `__sveltets_2_unwrapArr`: only an array-like source yields its item
 * type; any other source (a `Set`, a `Map`) infers `unknown`, so the
 * slot binding a consumer receives is `unknown` too.
 */
declare function __svn_unwrap_arr<T>(arr: ArrayLike<T>): T;
declare function __sveltets_2_unwrapArr<T>(arr: ArrayLike<T>): T;
/** Value-level result of an `{#await}` source (`__sveltets_2_unwrapPromiseLike`). */
declare function __svn_unwrap_promise_like<T>(promise: PromiseLike<T> | T): T;
declare function __sveltets_2_unwrapPromiseLike<T>(promise: PromiseLike<T> | T): T;
/**
 * The instance a component constructor creates. A slot `let:` name
 * resolves to `__svn_instance_of(Comp).$$slot_def['slot'].name`
 * (`__sveltets_2_instanceOf`); a component that is not a constructor
 * fails the argument check and resolves to `any`, as upstream's does.
 */
declare function __svn_instance_of<T = any>(type: new (...args: any[]) => T): T;
declare function __sveltets_2_instanceOf<T = any>(type: new (...args: any[]) => T): T;

/**
 * Reviewer follow-up #2: extract a child component's events surface
 * for the parent's bubbled-event projection. When the wrapper has
 * `<Child on:NAME />` (no value, event-bubble shorthand), the
 * wrapper's own `$$Events` carries NAME with Child's declared event
 * type — projected as `__SvnComponentEvents<typeof Child>["NAME"]`.
 *
 * Three branches:
 *   1. `__svn_events` marker present (iso shape with declared
 *      $$Events) → return the marker's E.
 *   2. Plain `Component<P, X, B>` (fn-component shape, no events
 *      surface) → return `Record<string, any>` so the projected
 *      event types as `any` (matches upstream's lax fallback for
 *      runes-only components).
 *   3. Anything else (synthetic dynamic-component root, malformed
 *      input) → `Record<string, any>` lax fallback.
 *
 * Mirrors upstream svelte2tsx's `__sveltets_2_bubbleEventDef(
 * __sveltets_2_instanceOf(<Comp>).$$events_def, '<name>')`
 * semantics at type-level — we project from the typed marker
 * directly, no runtime helper call needed.
 */
/**
 * Reviewer follow-up #3 (round 4): also extract events from
 * legacy / external `SvelteComponentTyped<Props, Events, Slots>`
 * class constructors that don't carry the `__svn_events` marker.
 * Pre-fix only the marker branch fired, so package-installed
 * Svelte-3-style components forwarded their events as `any` when
 * a wrapper bubbled them.
 *
 * Branch order:
 *   1. `__svn_events` marker — our overlay's strict shape.
 *   2. Class constructor returning a `SvelteComponent<P, E, S>`
 *      instance — covers both legacy `SvelteComponentTyped<P, E,
 *      S>` (deprecated alias) and our own iso interface's `new`
 *      sig when the marker is absent. Inferring `E` directly
 *      from `SvelteComponent`'s second type parameter.
 *   3. Callable `Component<P, X, B>` (Svelte-5 fn-component
 *      shape) — no events parameter. Fall through to
 *      `Record<string, any>` for the lax fallback (matches
 *      upstream's behavior for runes-only components).
 */
type __SvnComponentEvents<C> = C extends { readonly __svn_events: infer E }
    ? E
    : C extends new (...args: any[]) => import('svelte').SvelteComponent<any, infer E extends Record<string, any>, any>
      ? E
      : Record<string, any>;

/**
 * SlotHandler PLAN Stage 4: extract a child component's slot
 * surface for the parent's let-forwarded slot projection. When
 * a wrapper has `<Wrapper let:tooltip><slot {tooltip}/></Wrapper>`,
 * the slot-def's `tooltip` entry projects as
 * `__SvnComponentSlots<typeof Wrapper>['default']['tooltip']`.
 *
 * Branch order:
 *   1. `__svn_slots` marker — reserved for a future strict-shape
 *      opt-in (no current emit path produces it).
 *   2. Class constructor returning a `SvelteComponent<P, E, S>`
 *      instance — extracts `S` directly. Covers our iso interface's
 *      `new` signature AND legacy `SvelteComponentTyped<P, E, S>`
 *      class components.
 *   3. Anything else (callable `Component<P, X, B>` /
 *      synthetic root) → `Record<string, Record<string, any>>` so
 *      `[slotName][propName]` indexing falls through to `any`
 *      without a TS lookup error.
 */
type __SvnComponentSlots<C> = C extends { readonly __svn_slots: infer S }
    ? S
    : C extends new (...args: any[]) => import('svelte').SvelteComponent<any, any, infer S extends Record<string, any>>
      ? S
      : Record<string, Record<string, any>>;

/**
 * Reviewer follow-up #3b: convert a wrapped `$$Events` map back to
 * the DETAIL form for `createEventDispatcher`'s type argument. The
 * wrapped form `{ name: CustomEvent<T> }` is what the user declares
 * in `interface $$Events`; the dispatcher's `<T>` wants the inner
 * detail type for each entry, so unwrap each `CustomEvent<…>`
 * back to `…`.
 *
 * Mirrors upstream `__sveltets_2_CustomEvents` in
 * `svelte2tsx/svelte-shims.d.ts`. Used in the synthesised
 * `createEventDispatcher<__SvnCustomEvents<$$Events>>()` rewrite —
 * after the rewrite, `dispatch('name', detail)` calls type-check
 * `detail` against the original `$$Events.name` payload type.
 */
/**
 * Reviewer follow-up #4 (round 4): filter to keys whose declared
 * value is `CustomEvent<…>` so non-CustomEvent declared events
 * don't leak into the dispatcher's signature. Pre-fix the helper
 * kept every key of `$$Events` and merely unwrapped CustomEvent —
 * so an `interface $$Events { click: MouseEvent }` would
 * incorrectly permit `dispatch('click', …)` on an event that's
 * actually a native DOM event (which Svelte's runtime can't
 * dispatch via `createEventDispatcher`).
 *
 * Mirrors upstream `__sveltets_2_CustomEvents` byte-for-byte
 * (`svelte-shims.d.ts:139-141`): `KeysMatching<T, CustomEvent>`
 * narrows to dispatchable entries; the inner conditional
 * unwraps the detail type per entry.
 */
type __SvnKeysMatching<Obj, V> = {
    [K in keyof Obj]-?: Obj[K] extends V ? K : never;
}[keyof Obj];

type __SvnCustomEvents<T> = {
    [K in __SvnKeysMatching<T, CustomEvent>]: T[K] extends CustomEvent ? T[K]['detail'] : T[K];
};

/**
 * Fresh `any` placeholder. Used as the anchor / target argument in the
 * emitted `new Comp({ target: __svn_any(), props: {...} })` call.
 *
 * Declared generic with `T = any` so callers can narrow the return at
 * the call site when needed; default usage gets plain `any`.
 */
declare function __svn_any<T = any>(): T;

/**
 * `<svelte:self>` synthetic — the file's own component default
 * referenced from inside its own template. We can't easily get
 * "the component's own props" inside its own render fn (circular
 * dep), so type as `any`-component: the `new __svn_C({…})` call
 * goes through `__svn_ensure_component(__svn_self_default)` which
 * returns an `any`-prop ctor. Excess-prop checks degenerate to
 * "any prop accepted" but the rest of the component (events,
 * bindings, children) still type-checks via the normal path.
 *
 * Mirrors upstream svelte2tsx's `__sveltets_2_createComponentAny`
 * for `<svelte:self>` (see InlineComponent.ts:99).
 */
declare const __svn_self_default: import('svelte').Component<any, {}, any>;

/**
 * JS-overlay definite-assign: `let b; b = __svn_any(b);` is the JS
 * equivalent of the TS-overlay `let b!: T;` splice — a self-assign
 * through an any-cast helper that satisfies TS flow analysis without
 * emitting TS-only syntax (`!:`, `as`) that would fire TS8010 in a
 * `.svelte.svn.js` file. Mirrors upstream svelte2tsx's
 * `__sveltets_2_any(name)` self-assignment pattern (see
 * ExportedNames.ts; produces `b = __sveltets_2_any(b)` after each
 * Svelte-4 `export let` declaration).
 *
 * Return type is `any` unconditionally — the purpose is to widen,
 * not preserve, so downstream reads aren't flow-narrowed back to
 * the original (possibly uninitialised-shaped) type.
 */
declare function __svn_any(x: any): any;

/**
 * Type-erasing wrapper that returns `{}` regardless of its inputs.
 * Mirrors upstream svelte2tsx's `__sveltets_2_empty` (svelte-shims-v4.d.ts:139).
 *
 * Used to wrap `data-*` attribute pairs in DOM-element createElement
 * calls so TS sees the value expression as a real read (suppressing
 * TS6133 on identifiers used only there) without polluting the
 * strict typed-attribute interface with the dynamic key. Emit
 * pattern (matches upstream Attribute.ts:86-94):
 *
 *     svelteHTML.createElement("div", {
 *         ...__svn_empty({"data-tid": tid}),
 *     });
 *
 * The spread of `{}` injects nothing into the resulting object,
 * so per-element strict typing still works; the inner `{...}`
 * literal is type-checked normally so `tid` counts as referenced.
 */
declare function __svn_empty(...dummy: any[]): {};

/**
 * `interface $$Props` cross-check shim. When the component declares a
 * Svelte-4 `$$Props` interface AND a sibling `export let X: T`, the
 * render fn returns its props as
 *
 *     { ...__svn_ensure_right_props<{ X: T; ... }>(__svn_any("") as $$Props) } as $$Props
 *
 * (mirrors upstream svelte2tsx's `__sveltets_2_ensureRightProps` —
 * `svelte-shims-v4.d.ts:62`). The type-arg constraint fires TS2345
 * when `$$Props['X']` is wider than `T` (optional vs required) or
 * missing a let-declared name. The `: {}` return is intentionally
 * empty so the spread leaves the surrounding `as $$Props` cast as
 * the props' final type — no inference leak from the assertion.
 */
declare function __svn_ensure_right_props<Props>(props: Props): {};

/**
 * Svelte 5 `bind:X={getter, setter}` helper. Mirrors upstream
 * `__sveltets_2_get_set_binding` (svelte2tsx/svelte-shims-v4.d.ts:269)
 * with the `__svn_*` prefix mandated by CLAUDE.md architecture rule #6.
 *
 * `T` is inferred once per call site. The getter's return and the
 * setter's parameter are BOTH checked against `T`, and the return
 * flows to the prop slot — so a mismatched setter (e.g. `bind:value={
 * () => s, (n: number) => …}` where the child expects `string`) fires
 * TS2322/TS2345 at the call site. Without this helper, emit would
 * invoke just the getter (`(getter)()`) and the setter would go
 * type-unchecked.
 */
declare function __svn_get_set_binding<T>(
    get: (() => T) | null | undefined,
    set: (t: T) => void,
): T;

/**
 * Slot-prop type-checker factory. Mirrors upstream
 * `__sveltets_2_createCreateSlot<Slots>` (svelte2tsx/svelte-shims-
 * v4.d.ts:135) with the `__svn_*` prefix mandated by CLAUDE.md rule
 * #6.
 *
 * Emit calls this once per render fn (gated on the presence of
 * `<slot>` elements) and stashes the result in
 * `const __svn_create_slot = __svn_create_create_slot<$$Slots>();`.
 * Each `<slot name="X" prop1={…} prop2={…}>` then emits as
 * `__svn_create_slot("X", { prop1: …, prop2: … });` — the inner
 * call's signature checks the slot name against `keyof $$Slots`
 * (TS2345 on unknown names) and the attrs object against
 * `$$Slots[Name]` (TS2322 on prop type mismatches, TS2353 on excess
 * props).
 *
 * When no `interface $$Slots` is declared, the default
 * `Record<string, Record<string, any>>` keeps every slot+attr pair
 * silent — Svelte-4 components that opt out of strict slot typing
 * pay no false-positive cost.
 */
declare function __svn_create_create_slot<
    Slots = Record<string, Record<string, any>>,
>(): <SlotName extends keyof Slots>(
    slotName: SlotName,
    attrs: Slots[SlotName],
) => Record<string, any>;

/**
 * Carries the literal-string union of bindable prop names through
 * the render-fn's `bindings:` field for runes-mode components.
 * Mirrors upstream `__sveltets_$$bindings` (svelte2tsx/svelte-shims-
 * v4.d.ts:271) with the `__svn_*` prefix mandated by CLAUDE.md rule
 * #6.
 *
 * Each `bind:NAME={target}` site on a component instantiation emits
 * `__svn_inst_N.$$bindings = 'NAME';` post-`new`. The instance's
 * `$$bindings?: B` field is `?: 'a' | 'b'` for runes-mode components
 * with `let { a = $bindable(), b = $bindable() } = $props()`, so
 * assigning a non-bindable name fires TS2322 with the upstream
 * "Cannot use 'bind:' with this property" message after LS post-
 * filter. Svelte-4 components route through `bindings: string` (lax
 * — every `export let` / `export function` is bindable) so this
 * helper never fires there.
 */
declare function __svn_$$bindings<Bindings extends string[]>(
    ...bindings: Bindings
): Bindings[number];

/**
 * Normalize a component value to a constructor, so every instantiation
 * is emitted the same way:
 *
 *     { const $$_CN = __svn_ensure_component(Comp);
 *       new $$_CN({ target: __svn_any(), props: { ... } }); }
 *
 * Same declaration as upstream's `__sveltets_2_ensureComponent`:
 *
 *   - A class-form component (anything constructible into a value with
 *     the `$$prop_def` / `$$events_def` / `$$slot_def` carriers — our
 *     own `$$IsomorphicComponent` defaults included) passes through, so
 *     a generic class keeps its type parameters for the `new` site.
 *   - A Svelte 5 `Component<Props, Exports, Bindings>` becomes a
 *     constructor whose instance is `SvelteComponent<Props,
 *     Props['$$events'], Props['$$slots']>`. Props that do not declare
 *     `$$events` / `$$slots` leave the instance's events and slots
 *     `unknown`, so `on:` handlers, `slot="…"` children and `let:`
 *     bindings on such a component are not typed.
 *   - Anything else fails the constraint (a plain class: TS2345 at the
 *     component name) or, when it is callable like a `Component` (a
 *     helper function, `Date`), maps to `never`, which the `new`
 *     reports (TS2351).
 *
 * The intermediate local is what makes generic inference work: TS binds
 * the construct signature's generics at the `new` site, where the
 * concrete prop values are visible.
 */
declare function __svn_ensure_component<
    T extends
        | ConstructorOfATypedSvelteComponent
        | (typeof import('svelte') extends { mount: any }
              ? // @ts-ignore svelte.Component doesn't exist in Svelte 4
                import('svelte').Component<any, any, any>
              : never)
        | null
        | undefined,
>(
    type: T,
): NonNullable<
    T extends ConstructorOfATypedSvelteComponent
        ? T
        : typeof import('svelte') extends { mount: any }
          ? // @ts-ignore svelte.Component doesn't exist in Svelte 4
            T extends import('svelte').Component<
                infer Props extends Record<string, any>,
                infer Exports extends Record<string, any>,
                infer Bindings extends string
            >
              ? new (
                    options: import('svelte').ComponentConstructorOptions<Props>,
                ) => import('svelte').SvelteComponent<Props, Props['$$events'], Props['$$slots']> &
                    Exports & { $$bindings: Bindings }
              : never
          : never
>;
declare function __sveltets_2_ensureComponent<
    T extends
        | ConstructorOfATypedSvelteComponent
        | (typeof import('svelte') extends { mount: any }
              ? // @ts-ignore svelte.Component doesn't exist in Svelte 4
                import('svelte').Component<any, any, any>
              : never)
        | null
        | undefined,
>(
    type: T,
): NonNullable<
    T extends ConstructorOfATypedSvelteComponent
        ? T
        : typeof import('svelte') extends { mount: any }
          ? // @ts-ignore svelte.Component doesn't exist in Svelte 4
            T extends import('svelte').Component<
                infer Props extends Record<string, any>,
                infer Exports extends Record<string, any>,
                infer Bindings extends string
            >
              ? new (
                    options: import('svelte').ComponentConstructorOptions<Props>,
                ) => import('svelte').SvelteComponent<Props, Props['$$events'], Props['$$slots']> &
                    Exports & { $$bindings: Bindings }
              : never
          : never
>;

/**
 * Partial<> variant that widens each prop with `| null`. Required
 * props become optional (same as `Partial<>` — bind:, spread, and
 * implicit children absorb the "missing" case), AND variables the
 * user typed `T | null` (common with `bind:this` stored in `$state<T
 * | null>(null)`) can be passed in without a TS2322 "`HTMLElement |
 * null` not assignable to `HTMLElement | undefined`" mismatch.
 * Excess-property checks (typo'd prop names) and contextual-typing
 * flow (callback destructures, snippet params) are preserved.
 */
type __SvnPropsPartial<P> = { [K in keyof P]?: P[K] | null };

// v0.3 Item 7: the `__svn_bind_this_check<El>(target)` shim that
// previously lived here was removed. Its `target: El | null |
// undefined` signature rejected legitimate broader-type declarations
// (`let el: HTMLElement | null` on a `<div>`) because `HTMLElement`
// is a SUPERTYPE of `HTMLDivElement`. Current Item 7 emit uses the
// assignment-direction shape (matches upstream's Binding.ts:85-93):
//     void /* bind:this */ ((): void => {
//         EXPR = null as any as HTMLElementTagNameMap['tag'];
//     });
// where the LHS-accepts-RHS check correctly admits broader
// declared types while still flagging truly-wrong element types
// (e.g. `HTMLSpanElement` declared, bound on `<input>`).

/**
 * Phantom type-compatibility check for one-way-not-on-element DOM
 * bindings. Used in the template-check body for directives like
 * `bind:contentRect={rect}` / `bind:buffered={buf}` where the runtime
 * type lives on a separate browser API (ResizeObserver for
 * content-rect, HTMLMediaElement SvelteMediaTimeRange for buffered).
 *
 * Called as `__svn_any_as<DOMRectReadOnly>(rect);`. The single
 * argument being typed `T` means `rect`'s declared type must accept
 * `T` — TS2322 fires on `let rect: string; __svn_any_as<DOMRectReadOnly>(rect);`.
 * No return, no side effect, no mutation to `rect`'s inferred type:
 * the call vanishes under `void`-free evaluation, and TS flow
 * analysis sees only a "read rect" followed by no narrowing.
 */
declare function __svn_any_as<T>(value: T): void;

/**
 * Branded-`any` return for snippet arrow-callback bodies. Svelte's
 * `Snippet<[...]>` type brands its return shape so a bare
 * `(args) => void` can't structurally satisfy it. The arrow emits a
 * `return __svn_snippet_return();` tail so the callback assigns
 * cleanly into a `Snippet<[...]>` prop slot while contextual typing
 * still flows from the slot's signature into the parameters.
 */
declare function __svn_snippet_return(): any;

/**
 * CSS-custom-property prop on a component — Svelte 5 accepts
 * `<Foo --accent-color="red">` as a CSS variable passthrough to
 * the component's wrapper, NOT as a typed prop. Emit spreads the
 * value through this helper so the key contributes `{}` (nothing)
 * to the component's Props object — no TS2353 "does not exist in
 * type" against the component's declared Props. Mirrors upstream
 * svelte2tsx's `__sveltets_2_cssProp`.
 */
declare function __svn_css_prop(prop: Record<string, any>): {};

/**
 * Action-directive return shape — matches Svelte's `ActionReturn` plus
 * the `$$_attributes` hook svelte2tsx uses to forward action-declared
 * attributes back onto the element.
 */
type __SvnActionReturnType =
    | {
          update?: (args: any) => void;
          destroy?: () => void;
          $$_attributes?: Record<string, any>;
      }
    | void;

/**
 * Wraps an action invocation — `action(element, params)` — so its
 * return value type-checks against `ActionReturn` and any
 * `$$_attributes` the action advertises can be picked up by the
 * enclosing element's attribute pass.
 *
 * The important half for us is the ARGUMENT side: `action(element,
 * params)` is a real function call, so TypeScript contextually types
 * `params` against the action's declared second parameter. For
 * `use:enhance={({formData}) => ...}` that flows `SubmitFunction`'s
 * parameter shape into the arrow's destructure — and fires TS2339 on
 * any property name that isn't on that shape (the user-reported
 * `{form, data, submit}` miss).
 */
declare function __svn_ensure_action<T extends __SvnActionReturnType>(
    actionCall: T,
): T extends { $$_attributes?: any } ? T['$$_attributes'] : {};

/**
 * Transition-directive return shape — matches Svelte's
 * `TransitionConfig` (or a thunk producing one). Mirrors upstream's
 * `__sveltets_2_SvelteTransitionReturnType` at
 * `language-tools/packages/svelte2tsx/svelte-shims-v4.d.ts:175-176`.
 */
type __SvnTransitionConfig = {
    delay?: number;
    duration?: number;
    easing?: (t: number) => number;
    css?: (t: number, u: number) => string;
    tick?: (t: number, u: number) => void;
};
type __SvnTransitionReturnType = __SvnTransitionConfig | (() => __SvnTransitionConfig);

/**
 * Wraps a `transition:` / `in:` / `out:` directive invocation —
 * `transitionFn(element, params)` — so its return value type-checks
 * against `TransitionConfig`. The wrapper is also the syntactic
 * anchor the diagnostic post-filter
 * (`crates/typecheck/src/filters.rs::is_overlay_in_ensure_transition_call`)
 * uses to drop TS2554 "Expected 3 arguments" — Svelte's transition
 * runtime supplies the optional 3rd `_context` parameter, but tsgo
 * fires 2554 when the user's transition function declares it as
 * required and we only pass 2 args at the synthetic call site. Mirrors
 * upstream's `__sveltets_2_ensureTransition` + the
 * `expectedTransitionThirdArgument` filter at
 * `language-server/src/plugins/typescript/features/DiagnosticsProvider.ts:663-700`.
 */
declare function __svn_ensure_transition(transitionCall: __SvnTransitionReturnType): {};

/**
 * Intersect up to N action-return-attributes types so they flow
 * through `svelteHTML.createElement("tag", actions, attrs)`'s 3-arg
 * overload. Upstream `svelte2tsx` emits this as `__sveltets_2_union`;
 * the signature is the same — return type is `T1 & T2 & T3 & …`.
 *
 * Called as `__svn_union(__svn_action_0, __svn_action_1, …)` when an
 * element has `use:` directives. The intersection is the second arg
 * to `svelteHTML.createElement` (the `attrsEnhancers: T` slot); the
 * attrs literal's type becomes `Elements[Key] & T` which tsgo
 * eagerly expands (unlike the 2-arg overload's `Elements[Key]` alias
 * form). This gives TS2353 diagnostic messages against the expanded
 * `Omit<HTMLAttributes<HTMLDivElement>, never> & HTMLAttributes<any>`
 * form that matches upstream byte-for-byte.
 */
declare function __svn_union<T1, T2, T3, T4, T5, T6, T7, T8, T9, T10>(
    t1: T1,
    t2?: T2,
    t3?: T3,
    t4?: T4,
    t5?: T5,
    t6?: T6,
    t7?: T7,
    t8?: T8,
    t9?: T9,
    t10?: T10,
): T1 & T2 & T3 & T4 & T5 & T6 & T7 & T8 & T9 & T10;

/**
 * Map an HTML/SVG tag name back to the real element type so action
 * directives emit `action(__svn_map_element_tag('form'), params)` with
 * a proper `HTMLFormElement` in the first slot. Actions that declare a
 * specific element type (e.g. `Action<HTMLFormElement, P>`) are checked
 * against the concrete type.
 *
 * Same overloads as upstream's `svelteHTML.mapElementTag`: any other
 * tag — a custom element, `svelte:window`, `svelte:element` — maps to
 * `any`, so the directive's element parameter is unconstrained there.
 */
declare function __svn_map_element_tag<K extends keyof ElementTagNameMap>(
    tag: K,
): ElementTagNameMap[K];
declare function __svn_map_element_tag<K extends keyof SVGElementTagNameMap>(
    tag: K,
): SVGElementTagNameMap[K];
declare function __svn_map_element_tag(tag: any): any;

/**
 * Phantom value used as the second argument to animate-directive call
 * emissions. Svelte's `Animation` typing declares
 *
 *     (node: Element, animation: { from: DOMRect; to: DOMRect }, params?: P) => AnimationConfig
 *
 * — the middle slot has a fixed structural shape we don't synthesize
 * at the call site. Mirrors upstream svelte2tsx's
 * `__sveltets_2_AnimationMove`. See the `animate:` directive emit
 * (`crates/emit/src/nodes/animation.rs`).
 */
declare const __svn_AnimationMove: { from: DOMRect; to: DOMRect };
declare var __sveltets_2_AnimationMove: { from: DOMRect; to: DOMRect };

/**
 * Result shape an `animate:` function must return. Mirrors upstream's
 * `__sveltets_2_SvelteAnimationReturnType`: an all-optional object
 * type, so a function returning anything with no property in common
 * (a cleanup thunk, a number) fails as a weak-type mismatch (TS2559).
 */
type __SvnAnimationReturnType = {
    delay?: number;
    duration?: number;
    easing?: (t: number) => number;
    css?: (t: number, u: number) => string;
    tick?: (t: number, u: number) => void;
};
type __sveltets_2_SvelteAnimationReturnType = __SvnAnimationReturnType;
/** Wraps an `animate:NAME(...)` call so its result is checked as an animation config. */
declare function __svn_ensure_animation(animationCall: __SvnAnimationReturnType): {};
declare function __sveltets_2_ensureAnimation(animationCall: __SvnAnimationReturnType): {};

/**
 * Wraps the call of a `{@render EXPR}` tag. The parameter is the value
 * a Svelte snippet returns — a branded type no ordinary function
 * produces — so rendering something that is not a snippet (a function
 * returning `void` or `string`) fails the argument check (TS2345).
 * `undefined` / `null` pass, for optional-chained `{@render s?.()}`.
 */
declare function __svn_ensure_snippet(
    val: ReturnType<import('svelte').Snippet> | undefined | null,
): any;
declare function __sveltets_2_ensureSnippet(
    val: ReturnType<import('svelte').Snippet> | undefined | null,
): any;

/**
 * Validate that a style-directive value expression type-checks
 * against the set of legal CSS-value runtime types. Emitted for
 * each `style:prop={value}` as
 *   `__svn_ensure_type(String, Number, value);`
 * and for each text+mustache quoted form as
 *   `__svn_ensure_type(String, Number, \`…${expr}…\`);`
 *
 * The single-type form accepts `T | undefined | null`; the two-type
 * form accepts `T1 | T2 | undefined | null`. Passing an `unknown`
 * binding fires TS2345 "Argument of type 'unknown' is not
 * assignable…", mirroring upstream svelte2tsx's
 * `__sveltets_2_ensureType` behavior
 * (`language-tools/packages/svelte2tsx/svelte-shims-v4.d.ts:180-181`).
 *
 * Historical note: previously the 3rd param was loose `unknown`.
 * That was a workaround for charting-lib-style Canvas/Html/Svg
 * TS7034/7005 false-positives on Svelte-4 `export let zIndex =
 * undefined` props. The JS-overlay flip (`.svelte.svn.js` for
 * lang=js sources) routes those files through `noImplicitAny:false`,
 * so the strict constraint is safe now. The stricter form is
 * load-bearing for CMS-style component-preview / style-directive
 * TS2345/TS18046 diagnostics.
 */
declare function __svn_ensure_type<T>(
    type: new (...args: any[]) => T,
    el: T | undefined | null,
): {};
declare function __svn_ensure_type<T1, T2>(
    type1: new (...args: any[]) => T1,
    type2: new (...args: any[]) => T2,
    el: T1 | T2 | undefined | null,
): {};

// Ambient `svelteHTML` namespace — VENDORED VERBATIM from upstream
// language-tools/packages/svelte2tsx/svelte-jsx-v4.d.ts (MIT-licensed).
// Mirrors upstream svelte-check's bundled `svelte-jsx-v4.d.ts` so the
// DOM-element emit (`svelteHTML.createElement("tag", { …attrs })`)
// resolves with full per-element attribute typing.
//
// Why vendor instead of referencing user's `svelte/svelte-html.d.ts`:
// svelte's package.json doesn't expose svelte-html.d.ts through its
// `exports` map (by design — "deliberately not exposed through the
// exports map" per its header). Upstream `svelte-check` vendors this
// same file; we follow suit.
//
// Per-element attribute types resolve through
// `import('svelte/elements').SvelteHTMLElements[K]`. When the user has
// svelte installed, real attribute catalogs flow through (full
// per-element typing: `button.type: "button"|"reset"|"submit"|...`).
// Without svelte, our fallback resolves `HTMLAttributes<T> = any` and
// the check degrades gracefully.

declare namespace svelteHTML {
    function mapElementTag<K extends keyof ElementTagNameMap>(
        tag: K
    ): ElementTagNameMap[K];
    function mapElementTag<K extends keyof SVGElementTagNameMap>(
        tag: K
    ): SVGElementTagNameMap[K];
    function mapElementTag(tag: any): any;

    function createElement<Elements extends IntrinsicElements, Key extends keyof Elements>(
        element: Key | undefined | null,
        attrs: string extends Key ? import('svelte/elements').HTMLAttributes<any> : Elements[Key]
    ): Key extends keyof ElementTagNameMap
        ? ElementTagNameMap[Key]
        : Key extends keyof SVGElementTagNameMap
            ? SVGElementTagNameMap[Key]
            : any;
    function createElement<Elements extends IntrinsicElements, Key extends keyof Elements, T>(
        element: Key | undefined | null,
        attrsEnhancers: T,
        attrs: (string extends Key ? import('svelte/elements').HTMLAttributes<any> : Elements[Key]) & T
    ): Key extends keyof ElementTagNameMap
        ? ElementTagNameMap[Key]
        : Key extends keyof SVGElementTagNameMap
            ? SVGElementTagNameMap[Key]
            : any;

    interface HTMLAttributes<T extends EventTarget = any> {}
    interface SVGAttributes<T extends EventTarget = any> {}

    type HTMLProps<Property extends keyof import('svelte/elements').SvelteHTMLElements, Override> =
        Omit<import('svelte/elements').SvelteHTMLElements[Property], keyof Override> & Override;

    interface IntrinsicElements {
        a: HTMLProps<'a', HTMLAttributes>;
        abbr: HTMLProps<'abbr', HTMLAttributes>;
        address: HTMLProps<'address', HTMLAttributes>;
        area: HTMLProps<'area', HTMLAttributes>;
        article: HTMLProps<'article', HTMLAttributes>;
        aside: HTMLProps<'aside', HTMLAttributes>;
        audio: HTMLProps<'audio', HTMLAttributes>;
        b: HTMLProps<'b', HTMLAttributes>;
        base: HTMLProps<'base', HTMLAttributes>;
        bdi: HTMLProps<'bdi', HTMLAttributes>;
        bdo: HTMLProps<'bdo', HTMLAttributes>;
        big: HTMLProps<'big', HTMLAttributes>;
        blockquote: HTMLProps<'blockquote', HTMLAttributes>;
        body: HTMLProps<'body', HTMLAttributes>;
        br: HTMLProps<'br', HTMLAttributes>;
        button: HTMLProps<'button', HTMLAttributes>;
        canvas: HTMLProps<'canvas', HTMLAttributes>;
        caption: HTMLProps<'caption', HTMLAttributes>;
        cite: HTMLProps<'cite', HTMLAttributes>;
        code: HTMLProps<'code', HTMLAttributes>;
        col: HTMLProps<'col', HTMLAttributes>;
        colgroup: HTMLProps<'colgroup', HTMLAttributes>;
        data: HTMLProps<'data', HTMLAttributes>;
        datalist: HTMLProps<'datalist', HTMLAttributes>;
        dd: HTMLProps<'dd', HTMLAttributes>;
        del: HTMLProps<'del', HTMLAttributes>;
        details: HTMLProps<'details', HTMLAttributes>;
        dfn: HTMLProps<'dfn', HTMLAttributes>;
        dialog: HTMLProps<'dialog', HTMLAttributes>;
        div: HTMLProps<'div', HTMLAttributes>;
        dl: HTMLProps<'dl', HTMLAttributes>;
        dt: HTMLProps<'dt', HTMLAttributes>;
        em: HTMLProps<'em', HTMLAttributes>;
        embed: HTMLProps<'embed', HTMLAttributes>;
        fieldset: HTMLProps<'fieldset', HTMLAttributes>;
        figcaption: HTMLProps<'figcaption', HTMLAttributes>;
        figure: HTMLProps<'figure', HTMLAttributes>;
        footer: HTMLProps<'footer', HTMLAttributes>;
        form: HTMLProps<'form', HTMLAttributes>;
        h1: HTMLProps<'h1', HTMLAttributes>;
        h2: HTMLProps<'h2', HTMLAttributes>;
        h3: HTMLProps<'h3', HTMLAttributes>;
        h4: HTMLProps<'h4', HTMLAttributes>;
        h5: HTMLProps<'h5', HTMLAttributes>;
        h6: HTMLProps<'h6', HTMLAttributes>;
        head: HTMLProps<'head', HTMLAttributes>;
        header: HTMLProps<'header', HTMLAttributes>;
        hgroup: HTMLProps<'hgroup', HTMLAttributes>;
        hr: HTMLProps<'hr', HTMLAttributes>;
        html: HTMLProps<'html', HTMLAttributes>;
        i: HTMLProps<'i', HTMLAttributes>;
        iframe: HTMLProps<'iframe', HTMLAttributes>;
        img: HTMLProps<'img', HTMLAttributes>;
        input: HTMLProps<'input', HTMLAttributes>;
        ins: HTMLProps<'ins', HTMLAttributes>;
        kbd: HTMLProps<'kbd', HTMLAttributes>;
        keygen: HTMLProps<'keygen', HTMLAttributes>;
        label: HTMLProps<'label', HTMLAttributes>;
        legend: HTMLProps<'legend', HTMLAttributes>;
        li: HTMLProps<'li', HTMLAttributes>;
        link: HTMLProps<'link', HTMLAttributes>;
        main: HTMLProps<'main', HTMLAttributes>;
        map: HTMLProps<'map', HTMLAttributes>;
        mark: HTMLProps<'mark', HTMLAttributes>;
        menu: HTMLProps<'menu', HTMLAttributes>;
        menuitem: HTMLProps<'menuitem', HTMLAttributes>;
        meta: HTMLProps<'meta', HTMLAttributes>;
        meter: HTMLProps<'meter', HTMLAttributes>;
        nav: HTMLProps<'nav', HTMLAttributes>;
        noscript: HTMLProps<'noscript', HTMLAttributes>;
        object: HTMLProps<'object', HTMLAttributes>;
        ol: HTMLProps<'ol', HTMLAttributes>;
        optgroup: HTMLProps<'optgroup', HTMLAttributes>;
        option: HTMLProps<'option', HTMLAttributes>;
        output: HTMLProps<'output', HTMLAttributes>;
        p: HTMLProps<'p', HTMLAttributes>;
        param: HTMLProps<'param', HTMLAttributes>;
        picture: HTMLProps<'picture', HTMLAttributes>;
        pre: HTMLProps<'pre', HTMLAttributes>;
        progress: HTMLProps<'progress', HTMLAttributes>;
        q: HTMLProps<'q', HTMLAttributes>;
        rp: HTMLProps<'rp', HTMLAttributes>;
        rt: HTMLProps<'rt', HTMLAttributes>;
        ruby: HTMLProps<'ruby', HTMLAttributes>;
        s: HTMLProps<'s', HTMLAttributes>;
        samp: HTMLProps<'samp', HTMLAttributes>;
        slot: HTMLProps<'slot', HTMLAttributes>;
        script: HTMLProps<'script', HTMLAttributes>;
        section: HTMLProps<'section', HTMLAttributes>;
        select: HTMLProps<'select', HTMLAttributes>;
        small: HTMLProps<'small', HTMLAttributes>;
        source: HTMLProps<'source', HTMLAttributes>;
        span: HTMLProps<'span', HTMLAttributes>;
        strong: HTMLProps<'strong', HTMLAttributes>;
        style: HTMLProps<'style', HTMLAttributes>;
        sub: HTMLProps<'sub', HTMLAttributes>;
        summary: HTMLProps<'summary', HTMLAttributes>;
        sup: HTMLProps<'sup', HTMLAttributes>;
        table: HTMLProps<'table', HTMLAttributes>;
        template: HTMLProps<'template', HTMLAttributes>;
        tbody: HTMLProps<'tbody', HTMLAttributes>;
        td: HTMLProps<'td', HTMLAttributes>;
        textarea: HTMLProps<'textarea', HTMLAttributes>;
        tfoot: HTMLProps<'tfoot', HTMLAttributes>;
        th: HTMLProps<'th', HTMLAttributes>;
        thead: HTMLProps<'thead', HTMLAttributes>;
        time: HTMLProps<'time', HTMLAttributes>;
        title: HTMLProps<'title', HTMLAttributes>;
        tr: HTMLProps<'tr', HTMLAttributes>;
        track: HTMLProps<'track', HTMLAttributes>;
        u: HTMLProps<'u', HTMLAttributes>;
        ul: HTMLProps<'ul', HTMLAttributes>;
        var: HTMLProps<'var', HTMLAttributes>;
        video: HTMLProps<'video', HTMLAttributes>;
        wbr: HTMLProps<'wbr', HTMLAttributes>;
        webview: HTMLProps<'webview', HTMLAttributes>;
        // SVG
        svg: HTMLProps<'svg', SVGAttributes>;

        animate: HTMLProps<'animate', SVGAttributes>;
        animateMotion: HTMLProps<'animateMotion', SVGAttributes>;
        animateTransform: HTMLProps<'animateTransform', SVGAttributes>;
        circle: HTMLProps<'circle', SVGAttributes>;
        clipPath: HTMLProps<'clipPath', SVGAttributes>;
        defs: HTMLProps<'defs', SVGAttributes>;
        desc: HTMLProps<'desc', SVGAttributes>;
        ellipse: HTMLProps<'ellipse', SVGAttributes>;
        feBlend: HTMLProps<'feBlend', SVGAttributes>;
        feColorMatrix: HTMLProps<'feColorMatrix', SVGAttributes>;
        feComponentTransfer: HTMLProps<'feComponentTransfer', SVGAttributes>;
        feComposite: HTMLProps<'feComposite', SVGAttributes>;
        feConvolveMatrix: HTMLProps<'feConvolveMatrix', SVGAttributes>;
        feDiffuseLighting: HTMLProps<'feDiffuseLighting', SVGAttributes>;
        feDisplacementMap: HTMLProps<'feDisplacementMap', SVGAttributes>;
        feDistantLight: HTMLProps<'feDistantLight', SVGAttributes>;
        feDropShadow: HTMLProps<'feDropShadow', SVGAttributes>;
        feFlood: HTMLProps<'feFlood', SVGAttributes>;
        feFuncA: HTMLProps<'feFuncA', SVGAttributes>;
        feFuncB: HTMLProps<'feFuncB', SVGAttributes>;
        feFuncG: HTMLProps<'feFuncG', SVGAttributes>;
        feFuncR: HTMLProps<'feFuncR', SVGAttributes>;
        feGaussianBlur: HTMLProps<'feGaussianBlur', SVGAttributes>;
        feImage: HTMLProps<'feImage', SVGAttributes>;
        feMerge: HTMLProps<'feMerge', SVGAttributes>;
        feMergeNode: HTMLProps<'feMergeNode', SVGAttributes>;
        feMorphology: HTMLProps<'feMorphology', SVGAttributes>;
        feOffset: HTMLProps<'feOffset', SVGAttributes>;
        fePointLight: HTMLProps<'fePointLight', SVGAttributes>;
        feSpecularLighting: HTMLProps<'feSpecularLighting', SVGAttributes>;
        feSpotLight: HTMLProps<'feSpotLight', SVGAttributes>;
        feTile: HTMLProps<'feTile', SVGAttributes>;
        feTurbulence: HTMLProps<'feTurbulence', SVGAttributes>;
        filter: HTMLProps<'filter', SVGAttributes>;
        foreignObject: HTMLProps<'foreignObject', SVGAttributes>;
        g: HTMLProps<'g', SVGAttributes>;
        image: HTMLProps<'image', SVGAttributes>;
        line: HTMLProps<'line', SVGAttributes>;
        linearGradient: HTMLProps<'linearGradient', SVGAttributes>;
        marker: HTMLProps<'marker', SVGAttributes>;
        mask: HTMLProps<'mask', SVGAttributes>;
        metadata: HTMLProps<'metadata', SVGAttributes>;
        mpath: HTMLProps<'mpath', SVGAttributes>;
        path: HTMLProps<'path', SVGAttributes>;
        pattern: HTMLProps<'pattern', SVGAttributes>;
        polygon: HTMLProps<'polygon', SVGAttributes>;
        polyline: HTMLProps<'polyline', SVGAttributes>;
        radialGradient: HTMLProps<'radialGradient', SVGAttributes>;
        rect: HTMLProps<'rect', SVGAttributes>;
        stop: HTMLProps<'stop', SVGAttributes>;
        switch: HTMLProps<'switch', SVGAttributes>;
        symbol: HTMLProps<'symbol', SVGAttributes>;
        text: HTMLProps<'text', SVGAttributes>;
        textPath: HTMLProps<'textPath', SVGAttributes>;
        tspan: HTMLProps<'tspan', SVGAttributes>;
        use: HTMLProps<'use', SVGAttributes>;
        view: HTMLProps<'view', SVGAttributes>;

        // Svelte specific
        'svelte:window': HTMLProps<'svelte:window', HTMLAttributes>;
        'svelte:body': HTMLProps<'svelte:body', HTMLAttributes>;
        'svelte:document': HTMLProps<'svelte:document', HTMLAttributes>;
        'svelte:fragment': { slot?: string };
        'svelte:options': { [name: string]: any };
        'svelte:head': { [name: string]: any };

        [name: string]: { [name: string]: any };
    }
}

// ---------- asset side-effect imports ----------
//
// Bundlers (Vite, webpack, etc.) let user code do side-effect imports
// of assets. Two flavours we cover here:
//
//   1. File-extension imports:  `import './styles.css'`,
//      `import 'swiper/bundle.min.css'`. Matches `*.css` pattern —
//      the literal file extension is part of the specifier.
//   2. Package-subpath imports: `import 'swiper/css'`,
//      `import 'swiper/css/navigation'`. These are package
//      `exports`-map subpaths whose specifiers don't end in `.css`
//      but resolve to CSS files at runtime. Vite's own package.json
//      exports handles this; tsgo's overlay never sees it and fires
//      TS2307 "Cannot find module 'swiper/css'".
//
// Vite's `vite/client.d.ts` declares the `*.css` ambients but not the
// package-subpath shape. Upstream svelte-check silently accepts
// package subpaths — likely because svelte-kit projects transitively
// load `vite/client` AND the tsgo-side module resolver is more
// permissive on unresolved side-effect imports (no `.ts` extension
// to look for, so bundler auto-extension doesn't fire).
//
// Rather than try to enumerate every package-subpath shape
// (`*/css`, `*/styles.css`, etc.), silence side-effect imports
// generally by accepting the common asset extensions PLUS the
// `swiper/css`-style subpath via `*/css/*` and `*/css` patterns.
// Empty-body ambients resolve content to `{}` — import expressions
// compile to `any` and side-effect imports type-check without
// constraining content.
declare module '*.css' {}
declare module '*.scss' {}
declare module '*.sass' {}
declare module '*.less' {}
declare module '*.styl' {}
declare module '*.stylus' {}
declare module '*.pcss' {}
declare module '*.postcss' {}
// Package-subpath CSS imports (swiper/css, etc.). TS module patterns
// allow at most ONE `*` character per declaration, so the previous
// `'*/css/*'` form fired TS2696 against tsgo when `skipLibCheck` is
// off. Single-wildcard `'*/css'` covers the common `import 'pkg/css'`
// shape; deeper subpaths (`pkg/css/variant`) need real types from the
// publishing package or a project-specific declaration.
declare module '*/css' {}

//
// We declare only what's needed to make type-checking succeed for code
// that imports from the standard `svelte/*` entry points. When the real
// `svelte` package IS installed, its declarations win because they live
// inside node_modules and are loaded first by tsgo's resolver.
//
// This file is regenerated into the cache directory on every check;
// edits here belong in svn-typecheck's source.





































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































