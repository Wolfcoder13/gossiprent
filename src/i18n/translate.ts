import { createElement, Fragment, type ReactNode } from "react";
import { INTL_TAG, type Locale } from "./config";
import { createFormat } from "./format";
import type { Plural, Translator, Tree } from "./types";

function isPlural(value: unknown): value is Plural {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Plural).one === "string" &&
    typeof (value as Plural).other === "string"
  );
}

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * A translate function for one dictionary and locale. Pure, so it works the
 * same on the server (getT) and in client components (useT).
 */
export function createT<M extends Tree>(messages: M, locale: Locale): Translator<M> {
  const rules = new Intl.PluralRules(INTL_TAG[locale]);
  const format = createFormat(locale);

  const lookup = (key: string): unknown =>
    key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);

  const pick = (key: string, params?: { count?: unknown }): string => {
    const value = lookup(key);
    if (typeof value === "string") return value;
    if (isPlural(value)) {
      const count = typeof params?.count === "number" ? params.count : 0;
      return rules.select(count) === "one" ? value.one : value.other;
    }
    if (process.env.NODE_ENV !== "production") throw new Error(`Missing message "${key}"`);
    return key;
  };

  const fill = (text: string, params: Record<string, unknown> = {}): string =>
    text.replace(PLACEHOLDER, (match, name: string) => {
      const value = params[name];
      if (typeof value === "number") return format.number(value);
      return value === undefined ? match : String(value);
    });

  const t = ((key: string, params?: Record<string, unknown>) =>
    fill(pick(key, params), params)) as unknown as Translator<M>;

  t.rich = (key, values) => {
    const parts = pick(key, values).split(PLACEHOLDER);
    return createElement(
      Fragment,
      null,
      ...parts.map((part, i): ReactNode => {
        if (i % 2 === 0) return part;
        const value = (values as Record<string, ReactNode>)[part];
        return createElement(Fragment, { key: i }, typeof value === "number" ? format.number(value) : value);
      }),
    );
  };

  t.has = (key: string): key is never => {
    const value = lookup(key);
    return typeof value === "string" || isPlural(value);
  };

  return t;
}
