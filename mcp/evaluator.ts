/**
 * Declarative Decision Evaluator.
 * Evaluates discrete maps and ordered numeric rules without executing code.
 */

import type { DecisionConfig } from "../store/types.ts";

/**
 * Recursively traverses dot-notation keys (e.g. "review.status" or "tasks.tk-123.passed").
 */
export function getNestedValue(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  if (!obj || typeof obj !== "object" || !path) {
    return undefined;
  }
  return path.split(".").reduce<unknown>((curr, key) => {
    if (curr && typeof curr === "object" && key in (curr as Record<string, unknown>)) {
      return (curr as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * Evaluates a DecisionConfig against runtime data and shared execution context.
 */
export function evaluateDecisionNode(
  config: DecisionConfig,
  data: Record<string, unknown> = {},
  context: Record<string, unknown> = {},
): string {
  const rawVal = getNestedValue(data, config.field) ?? getNestedValue(context, config.field);

  // 1. Check config.map: discrete match
  if (rawVal !== undefined && config.map && String(rawVal) in config.map) {
    return config.map[String(rawVal)];
  }

  // 2. Check config.numericRules: permissive float parsing
  const numVal = typeof rawVal === "number"
    ? rawVal
    : (typeof rawVal === "string" ? parseFloat(rawVal) : NaN);

  if (!Number.isNaN(numVal) && config.numericRules && Array.isArray(config.numericRules)) {
    for (const rule of config.numericRules) {
      if (
        (rule.op === "<" && numVal < rule.value) ||
        (rule.op === "<=" && numVal <= rule.value) ||
        (rule.op === ">" && numVal > rule.value) ||
        (rule.op === ">=" && numVal >= rule.value) ||
        (rule.op === "==" && numVal === rule.value) ||
        (rule.op === "!=" && numVal !== rule.value)
      ) {
        return rule.condition;
      }
    }
  }

  // 3. Fallback to default
  return config.default;
}
