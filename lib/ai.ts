"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Asking a language model from this app: summarise a note, suggest an idea, write a quiz question.
 *
 * Every call goes through this file to the app's own route (`app/api/ai/route.ts`), which holds the
 * app's token; there is no key here and none to add. The things that go wrong are the same every
 * time, and these helpers handle them:
 *
 * 1. The model is sometimes unavailable or out of allowance. `askModel` never throws: it returns
 *    `{ ok: false, reason, message }`, and `message` is written for the screen.
 * 2. A page that waits on an answer with nothing on screen looks broken. `useAsk` gives a status
 *    (`thinking`, `unavailable`, `limited`, …) and `statusText` to show for each.
 * 3. A big prompt is refused. Over 8,000 characters in all, `askModel` returns `too-long` without
 *    sending anything.
 * 4. Structured answers arrive as text. With `json: true` the answer is parsed into `data`, and
 *    `example` tells the model the shape to answer in.
 *
 * Client-only, hence the directive: call these from event handlers, never during render or on load.
 */

export type AiRole = "system" | "user" | "assistant";
export type AiMessage = { role: AiRole; content: string };

/**
 * Why there is no answer. `limited`: `rate-limited`, `limit-app-day`, `limit-owner-month`.
 * `error`: `too-long`, `bad-request`, `unreadable`. Every other reason is `unavailable`.
 */
export type AiFailureReason =
  | "not-configured" | "unauthorized" | "not-live" | "paused" | "upstream" | "offline"
  | "rate-limited" | "limit-app-day" | "limit-owner-month"
  | "too-long" | "bad-request" | "unreadable";

export type AskOptions = {
  /** Instructions for the model: the role it plays, the tone, the length. Up to 1,000 characters are used. */
  system?: string;
  /** Ask for one JSON object, parsed into `data`. */
  json?: boolean;
  /** With `json`: a realistic example of the object you want back. The model answers in its shape. */
  example?: unknown;
  /** The longest answer, in tokens (about four characters each). Default 400, at most 1,000. */
  maxTokens?: number;
  /** 0 for the same answer every time, 1 for the most varied. */
  temperature?: number;
};

export type AskResult =
  | { ok: true; text: string; data?: unknown }
  | { ok: false; reason: AiFailureReason; message: string; retryAfterSeconds?: number };

export type AskStatus = "idle" | "thinking" | "done" | "unavailable" | "limited" | "error";

/** The most text one question may carry, across every message and the system text. */
export const MAX_PROMPT_CHARS = 8_000;
/** How much of `system` the model receives. */
export const MAX_SYSTEM_CHARS = 1_000;
/** Shown beside every input whose text goes to the model. Required. */
export const AI_PRIVACY_NOTE = "Text you enter is sent to an AI model provider.";

const MESSAGES: Record<AiFailureReason, string> = {
  "not-configured": "The assistant isn't set up for this app.",
  unauthorized: "The assistant isn't set up for this app.",
  "not-live": "The assistant isn't set up for this app.",
  paused: "The assistant isn't available right now.",
  upstream: "The assistant isn't available right now.",
  offline: "Couldn't reach the assistant. Check your connection and try again.",
  "rate-limited": "That's a lot of questions at once. Wait a moment and try again.",
  "limit-app-day": "The assistant has reached today's limit for this app.",
  "limit-owner-month": "The assistant has reached this month's limit.",
  "too-long": "That's too much text for the assistant; shorten it.",
  "bad-request": "The assistant couldn't read that request.",
  unreadable: "The assistant's answer couldn't be read. Try again.",
};

const LIMITED: readonly AiFailureReason[] = ["rate-limited", "limit-app-day", "limit-owner-month"];
const ERRORS: readonly AiFailureReason[] = ["too-long", "bad-request", "unreadable"];

function isReason(value: unknown): value is AiFailureReason {
  return typeof value === "string" && value in MESSAGES;
}

function failed(reason: AiFailureReason, message?: string, retryAfterSeconds?: number): AskResult {
  return { ok: false, reason, message: message || MESSAGES[reason], ...(retryAfterSeconds ? { retryAfterSeconds } : {}) };
}

/** The messages a question becomes: `system` first (cut to 1,000 characters), then the input. */
export function toMessages(input: string | readonly AiMessage[], system?: string): AiMessage[] {
  const messages: AiMessage[] = typeof input === "string" ? [{ role: "user", content: input }] : [...input];
  const instructions = system?.trim();
  return instructions ? [{ role: "system", content: instructions.slice(0, MAX_SYSTEM_CHARS) }, ...messages] : messages;
}

/** Characters a question carries: what is checked against `MAX_PROMPT_CHARS`. `example` counts as its JSON. */
export function promptLength(messages: readonly AiMessage[], example?: unknown): number {
  const shape = example === undefined ? 0 : (JSON.stringify(example)?.length ?? 0);
  return messages.reduce((total, message) => total + message.content.length, 0) + shape;
}

function between(text: string, open: string, close: string): string {
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  return start >= 0 && end > start ? text.slice(start, end + 1) : "";
}

/** The JSON in a model's answer, tolerating a code fence or a sentence around it; undefined when there is none. */
export function parseJsonAnswer(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? "";
  for (const attempt of [text.trim(), fenced.trim(), between(text, "{", "}"), between(text, "[", "]")]) {
    if (!attempt) continue;
    try {
      return JSON.parse(attempt);
    } catch {
      // try the next reading
    }
  }
  return undefined;
}

/**
 * Ask the model once. Never throws: a failure is `{ ok: false, reason, message }`, and `message`
 * is what to show. Call it from a click or a submit, never on load, on a timer or per keystroke.
 *
 *   const result = await askModel(`Summarise in two sentences:\n${note}`, { maxTokens: 200 });
 *   if (result.ok) setSummary(result.text); else setProblem(result.message);
 */
export async function askModel(input: string | readonly AiMessage[], options: AskOptions = {}): Promise<AskResult> {
  const messages = toMessages(input, options.system);
  if (!messages.some((message) => message.role === "user" && message.content.trim())) return failed("bad-request");
  const json = options.json === true;
  const example = json ? options.example : undefined;
  let length: number;
  try {
    length = promptLength(messages, example);
  } catch {
    return failed("bad-request");
  }
  if (length > MAX_PROMPT_CHARS) return failed("too-long");

  let body: Record<string, unknown> | null;
  try {
    // Same-origin and JSON: the only requests the route answers.
    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages,
        json,
        ...(example !== undefined ? { example } : {}),
        ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      }),
    });
    const parsed: unknown = await response.json().catch(() => null);
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return failed("offline");
  }

  if (body?.ok === true && typeof body.text === "string" && body.text.trim()) {
    if (!json) return { ok: true, text: body.text };
    const data = parseJsonAnswer(body.text);
    return data === undefined ? failed("unreadable") : { ok: true, text: body.text, data };
  }
  const reason = isReason(body?.reason) ? body.reason : "upstream";
  const retry = body?.retryAfterSeconds;
  return failed(reason, typeof body?.message === "string" ? body.message : undefined, typeof retry === "number" && retry > 0 ? Math.ceil(retry) : undefined);
}

/** The status a finished question leaves the page in. */
export function askStatus(result: AskResult): AskStatus {
  if (result.ok) return "done";
  if (LIMITED.includes(result.reason)) return "limited";
  if (ERRORS.includes(result.reason)) return "error";
  return "unavailable";
}

/** Words for a status, for the line beside the AI feature. Empty when there is nothing to say. */
export function aiStatusText(status: AskStatus): string {
  switch (status) {
    case "thinking": return "Thinking…";
    case "unavailable": return "The assistant isn't available right now. Try again in a moment.";
    case "limited": return "The assistant has reached its limit for now. Try again later.";
    case "error": return "The assistant couldn't answer that. Try again.";
    default: return "";
  }
}

/**
 * `askModel` with its state, for a component: `ask` from a click, then show `statusText` and the
 * answer. Only the latest question's answer is kept, so a slow earlier one never overwrites it.
 *
 *   const { ask, status, text, statusText, busy } = useAsk();
 */
export function useAsk() {
  const [state, setState] = useState<{ status: AskStatus; result: AskResult | null }>({ status: "idle", result: null });
  const latest = useRef(0);

  const ask = useCallback(async (input: string | readonly AiMessage[], options?: AskOptions): Promise<AskResult> => {
    const id = ++latest.current;
    setState({ status: "thinking", result: null });
    const result = await askModel(input, options);
    if (id === latest.current) setState({ status: askStatus(result), result });
    return result;
  }, []);

  const reset = useCallback(() => {
    latest.current += 1;
    setState({ status: "idle", result: null });
  }, []);

  const { status, result } = state;
  return {
    ask,
    reset,
    status,
    result,
    /** The answer's text, or "" until there is one. */
    text: result?.ok ? result.text : "",
    /** The parsed object, with `json: true`. Check its shape before using it. */
    data: result?.ok ? result.data : undefined,
    /** What to show beside the feature: "Thinking…", the failure's own message, or "". */
    statusText: result && !result.ok ? result.message : aiStatusText(status),
    busy: status === "thinking",
  };
}
