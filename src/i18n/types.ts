import type { ReactNode } from "react";

/** A message that depends on a count. Icelandic and English only have these two CLDR categories. */
export type Plural = { readonly one: string; readonly other: string };

/** A dictionary area: nested plain data (so it can be passed to client components). */
export type Tree = { readonly [key: string]: string | Plural | Tree };

/** The English dictionary must have exactly the Icelandic one's keys (values are free text). */
export type Shape<T> = T extends string
  ? string
  : T extends Plural
    ? Plural
    : { readonly [K in keyof T]: Shape<T[K]> };

/** Dot-separated keys of every message (string or plural) in a dictionary. */
export type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string | Plural ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

type At<T, K extends string> = K extends `${infer H}.${infer R}`
  ? At<T[H & keyof T], R>
  : T[K & keyof T];

/** Placeholder names in a message, e.g. "Hi {name}" → "name". */
type Holes<S> = S extends `${string}{${infer P}}${infer R}` ? P | Holes<R> : never;

type ParamsFor<V> = V extends Plural
  ? { count: number } & { [P in Exclude<Holes<V["one"] | V["other"]>, "count">]: string | number }
  : V extends string
    ? { [P in Holes<V>]: string | number }
    : never;

type ArgsFor<M, K extends string> =
  keyof ParamsFor<At<M, K>> extends never ? [params?: Record<string, never>] : [params: ParamsFor<At<M, K>>];

/** The translate function: `t("reviews.count", { count: 3 })`. */
export type Translator<M> = (<K extends Leaves<M>>(key: K, ...args: ArgsFor<M, K>) => string) & {
  /** Like `t`, but placeholders can be React nodes (e.g. a link inside a sentence). */
  rich<K extends Leaves<M>>(key: K, values: Record<string, ReactNode> & { count?: number }): ReactNode;
  /** True if `key` names a message (used to translate keys coming from zod). */
  has(key: string): key is Leaves<M>;
};
