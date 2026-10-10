"use client";

/**
 * Moving this app's data to another device, once, with a code.
 *
 * The sending device takes a snapshot of the database, encrypts it with a fresh code, and hands the
 * ciphertext to WishWhip, which keeps it for at most a day. The receiving device types the code (or
 * opens the link carrying it), fetches the ciphertext, decrypts it, checks it, and only replaces its
 * own data once the person confirms. WishWhip deletes its copy the first time it is fetched.
 *
 * The code is the key. WishWhip sees an id derived from it and the encrypted bytes, never the code,
 * so it cannot read anything and cannot give anything back if the code is lost. A wrong code, an
 * expired one and one already used all look the same: "That code isn't right or has expired."
 *
 * Tables holding Blobs, Files, ArrayBuffers or typed arrays (photos, recordings) are left out of the
 * snapshot, because JSON cannot carry them; the receiving device keeps whatever it had in them, and
 * never replaces a table that holds such data on its side either.
 *
 * Once the copy is fetched it is gone from WishWhip. If it then cannot be used here (a newer
 * version made it, another app did, or replacing failed), it is handed back under the same code,
 * so the person can try again; only if that fails too must they move again from the other device.
 *
 * Where `NEXT_PUBLIC_WISHWHIP_SYNC_URL` is not set (a preview, the workspace), the encrypted copy is
 * kept in this page's memory instead, so the whole flow can be tried in one tab, and `status()` says
 * moving only works on the live site.
 *
 * Client-only, hence the directive: call these from event handlers, not during render.
 */
import {
  exportDatabase,
  importDatabase,
  ImportError,
  parseExport,
  SEED_META_TABLE,
  type DatabaseHandle,
  type ImportResult,
  type StorageExport,
  type TableMap,
} from "@/lib/storage";

/** Crockford base32: no I, L, O or U, so a code read aloud or copied by hand survives. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Characters in a code: 100 random bits, five bits each. */
export const CODE_LENGTH = 20;

/** The largest encrypted body WishWhip accepts, as base64 characters. */
export const MAX_BODY_CHARS = 320_000;

/** First byte of an encrypted body: how the plaintext was packed before encryption. */
export const FORMAT_JSON = 0;
export const FORMAT_GZIP_JSON = 1;

const IV_BYTES = 12;
const ID_PREFIX = "wishwhip-move-id";
const KEY_SALT = "wishwhip-move-key";
const KEY_INFO = "v1";

/** Why moving stopped. Each one has a sentence in `MOVE_COPY` (see `components/move-panel.tsx`). */
export type MoveProblem =
  /** The code is malformed, unknown, expired, already used, or does not decrypt. */
  | "wrong-code"
  /** The data was saved by a newer version of this app than the one open here. */
  | "newer-version"
  /** The data belongs to a different app. */
  | "wrong-app"
  /** Too much to move with a code. */
  | "too-big"
  /** WishWhip's limits for this app or for this connection were reached. */
  | "busy"
  /** WishWhip does not move data for this address (a preview, an unknown host). */
  | "not-here"
  /** Moving is switched off for now. */
  | "paused"
  /** This browser cannot encrypt here (no secure connection). */
  | "no-crypto"
  /** The network or WishWhip failed. */
  | "failed";

export type MoveStatus = {
  available: boolean;
  /**
   * `no-url` — WishWhip has not given this deployment an address (a preview or the workspace): the
   *   flow still works inside this one page, so it can be tried, but nothing reaches another device.
   * `no-crypto` — no `crypto.subtle` (a plain-http address): moving cannot work here at all.
   * `paused` — WishWhip said moving is switched off; nothing is sent again until the page reloads.
   */
  reason?: "no-url" | "no-crypto" | "paused";
};

/** The export envelope, plus the tables that were left out because they hold binary data. */
export type MoveSnapshot = StorageExport & { leftOut: string[] };

export type MoveOutResult =
  | { ok: true; code: string; link: string; leftOut: string[]; tables: Record<string, number> }
  | { ok: false; reason: MoveProblem };

export type MoveInResult =
  | {
      ok: true;
      data: MoveSnapshot;
      tables: Record<string, number>;
      leftOut: string[];
      /** Hand the fetched copy back to WishWhip under the same code (after replacing failed); false if that failed. */
      putBack: () => Promise<boolean>;
    }
  /** `lost`: the copy was fetched, could not be used, and could not be handed back either. */
  | { ok: false; reason: MoveProblem; lost?: true };

/**
 * Every sentence the move panel shows. Kept together so the panel can be restyled without the
 * wording drifting: the words are part of what it promises (one code, one day, photos stay).
 */
export const MOVE_COPY = {
  heading: "Move to another device",
  intro: "Take everything in this app to another phone or computer with a one-time code.",
  moveOut: "Move to another device",
  moving: "Preparing a code…",
  codeIntro: "On the other device, open this app, choose \"I have a code\" and type this code, or open the link there.",
  copyCode: "Copy code",
  copyLink: "Copy link",
  copied: "Copied.",
  copyFailed: "Copying didn't work. Select the code and copy it by hand.",
  codeRules: "The code works once and expires after a day. Anyone who has it can take a copy of this data, so keep it to yourself. A lost code can't be recovered; just move again.",
  finish: "Done",
  haveCode: "I have a code",
  codeLabel: "Code from your other device",
  codePlaceholder: "XXXXX-XXXXX-XXXXX-XXXXX",
  check: "Check code",
  checking: "Checking…",
  fromLink: "This link carries a code from another device. Check it to see what it holds.",
  confirmTitle: "Replace what's on this device with the moved data?",
  confirmBody: "The moved data holds:",
  confirm: "Import and replace",
  replacing: "Replacing…",
  cancel: "Cancel",
  replaceWarning: "What's on this device now will be replaced.",
  nothingToImport: "Nothing in this move can be used here.",
  cancelled: "Nothing was changed. That code has now been used; to try again, move from the other device again.",
  done: "Done. This device now has the moved data.",
  applyFailed: "Replacing didn't work, and nothing was changed. Try again.",
  applyFailedLost: "Replacing didn't work, and nothing was changed. Try again, then move again from the other device.",
  leftOut: "Photos and other files don't move. They stay on the device they were added on.",
  leftHere: (tables: readonly string[]) => `Left here: ${tables.map((table) => `${table} (has photos)`).join(", ")}`,
  rows: (table: string, count: number) => `${table}: ${count}`,
  notHere: "Moving works on the live site, not here.",
  problems: {
    "wrong-code": "That code isn't right or has expired.",
    "newer-version": "Open the app's newest version first, then try again.",
    "wrong-app": "That code is for a different app.",
    "too-big": "There is too much here to move with a code.",
    busy: "Too many moves right now. Try again later.",
    "not-here": "Moving works on the live site, not here.",
    paused: "Moving isn't available right now. Try again later.",
    "no-crypto": "Moving needs a secure (https) address.",
    failed: "Moving didn't work. Check your connection and try again.",
  } satisfies Record<MoveProblem, string>,
  /** Instead of `problems` when the fetched copy could not be handed back: the code is used up. */
  lost: {
    "newer-version": "Open the app's newest version first, then move again from the other device.",
    failed: "Moving didn't work. Check your connection, then move again from the other device.",
  } satisfies Partial<Record<MoveProblem, string>>,
} as const;

/** The sentence for a problem, taking into account whether the code is used up. */
export function problemText(reason: MoveProblem, lost?: boolean): string {
  if (lost && (reason === "newer-version" || reason === "failed")) return MOVE_COPY.lost[reason];
  return MOVE_COPY.problems[reason];
}

// Set once WishWhip answers "paused"; nothing is sent again for the rest of this page's life.
let paused = false;

// The stand-in for WishWhip where no address is set: space id → encrypted body.
const memorySpaces = new Map<string, string>();

function moveUrl(): string | undefined {
  // Read by its full name so Next writes the value into the browser bundle at build time.
  const url = process.env.NEXT_PUBLIC_WISHWHIP_SYNC_URL;
  return url ? url : undefined;
}

function cryptoAvailable(): boolean {
  const subtle = globalThis.crypto?.subtle;
  return typeof subtle?.importKey === "function" && typeof globalThis.crypto.getRandomValues === "function";
}

/** Whether moving can work from here, and if not, why. */
export function status(): MoveStatus {
  if (!cryptoAvailable()) return { available: false, reason: "no-crypto" };
  if (paused) return { available: false, reason: "paused" };
  if (!moveUrl()) return { available: false, reason: "no-url" };
  return { available: true };
}

// ---------------------------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------------------------

/** A new code from 13 random bytes (the first 100 bits are used), as 20 characters with no dashes. */
export function codeFor(bytes: Uint8Array = globalThis.crypto.getRandomValues(new Uint8Array(13))): string {
  if (bytes.length * 8 < CODE_LENGTH * 5) throw new Error(`A code needs ${CODE_LENGTH * 5} bits.`);
  let code = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    const bit = index * 5;
    const byte = bit >> 3;
    const pair = (bytes[byte] << 8) | (bytes[byte + 1] ?? 0);
    code += ALPHABET[(pair >> (11 - (bit & 7))) & 31];
  }
  return code;
}

/**
 * What a person typed, as the code it stands for, or null when it cannot be one.
 *
 * Case does not matter, spaces and dashes are ignored, and the letters people confuse with digits
 * are read as those digits: I and L as 1, O as 0.
 */
export function canonicalCode(typed: string): string | null {
  const code = typed.toUpperCase().replace(/[\s\-_.]+/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  if (code.length !== CODE_LENGTH) return null;
  for (const character of code) if (!ALPHABET.includes(character)) return null;
  return code;
}

/** `XXXXX-XXXXX-XXXXX-XXXXX`, for showing. Anything that is not a code comes back as it was. */
export function formatCode(code: string): string {
  const canonical = canonicalCode(code);
  return canonical ? canonical.match(/.{5}/g)!.join("-") : code;
}

/** The code carried by a `#move=<code>` fragment, or null. */
export function codeFromHash(hash: string): string | null {
  const match = /(?:^#|&)move=([^&]*)/.exec(hash);
  if (!match) return null;
  try {
    return canonicalCode(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------------------------

const encoder = new TextEncoder();
const bytesOf = (text: string): Uint8Array<ArrayBuffer> => encoder.encode(text);

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

/** What WishWhip files the encrypted copy under: 22 characters of a hash of the code, never the code. */
export async function spaceIdFor(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytesOf(ID_PREFIX + code));
  return toBase64(new Uint8Array(digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 22);
}

async function keyFor(code: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", bytesOf(code), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: bytesOf(KEY_SALT), info: bytesOf(KEY_INFO) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function throughStream(bytes: Uint8Array<ArrayBuffer>, transform: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The additional data a body is sealed with: its format byte, then the space id. Binding the id means
 * a body cannot be replayed under another code; binding the format byte means it cannot be flipped
 * to make the other device unpack the plaintext the wrong way.
 */
async function additionalDataFor(format: number, code: string): Promise<Uint8Array<ArrayBuffer>> {
  const id = bytesOf(await spaceIdFor(code));
  const data = new Uint8Array(1 + id.length);
  data[0] = format;
  data.set(id, 1);
  return data;
}

/**
 * Encrypt text with a code: base64 of format byte, 12-byte IV, AES-256-GCM ciphertext, with the
 * format byte and the space id as additional data (`additionalDataFor`). Gzipped first where the
 * browser has `CompressionStream`.
 */
export async function encrypt(text: string, code: string, options: { compress?: boolean } = {}): Promise<string> {
  const canonical = canonicalCode(code);
  if (!canonical) throw new Error("Not a moving code.");
  const compress = (options.compress ?? true) && typeof CompressionStream === "function";
  const plain = compress ? await throughStream(bytesOf(text), new CompressionStream("gzip")) : bytesOf(text);
  const format = compress ? FORMAT_GZIP_JSON : FORMAT_JSON;
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const additionalData = await additionalDataFor(format, canonical);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, await keyFor(canonical), plain));
  const body = new Uint8Array(1 + IV_BYTES + sealed.length);
  body[0] = format;
  body.set(iv, 1);
  body.set(sealed, 1 + IV_BYTES);
  return toBase64(body);
}

/** The text `encrypt` sealed, or null for a wrong code, a damaged body or one this browser cannot unpack. */
export async function decrypt(body: string, code: string): Promise<string | null> {
  const canonical = canonicalCode(code);
  const bytes = fromBase64(body);
  if (!canonical || !bytes || bytes.length <= 1 + IV_BYTES) return null;
  const format = bytes[0];
  if (format !== FORMAT_JSON && format !== FORMAT_GZIP_JSON) return null;
  try {
    const additionalData = await additionalDataFor(format, canonical);
    const iv = bytes.subarray(1, 1 + IV_BYTES);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData }, await keyFor(canonical), bytes.subarray(1 + IV_BYTES)));
    if (format === FORMAT_JSON) return new TextDecoder().decode(plain);
    if (typeof DecompressionStream !== "function") return null;
    return new TextDecoder().decode(await throughStream(plain, new DecompressionStream("gzip")));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------------------------

/** Whether a value is, or contains, something JSON would silently turn into `{}`. */
function holdsBinary(value: unknown, depth = 0): boolean {
  if (value === null || typeof value !== "object" || depth > 8) return false;
  if (typeof Blob !== "undefined" && value instanceof Blob) return true;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
  if (Array.isArray(value)) return value.some((entry) => holdsBinary(entry, depth + 1));
  return Object.values(value).some((entry) => holdsBinary(entry, depth + 1));
}

/**
 * Every row of every table, as the export file has it, minus any table holding binary data
 * (named in `leftOut`). Read in one transaction, so it is self-consistent.
 */
export async function snapshot<Tables extends TableMap>(database: DatabaseHandle<Tables>): Promise<MoveSnapshot> {
  const data = await exportDatabase(database);
  const tables: Record<string, unknown[]> = {};
  const leftOut: string[] = [];
  for (const [name, rows] of Object.entries(data.tables)) {
    if (name === SEED_META_TABLE) continue;
    if (rows.some((row) => holdsBinary(row))) leftOut.push(name);
    else tables[name] = rows;
  }
  return { ...data, tables, leftOut };
}

function rowCounts(tables: Record<string, unknown>, only?: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [name, rows] of Object.entries(tables)) {
    if (only && !only.includes(name)) continue;
    counts[name] = Array.isArray(rows) ? rows.length : 0;
  }
  return counts;
}

// ---------------------------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------------------------

type Answer = { ok: true; body?: string } | { ok: false; reason: string };

/** One request to WishWhip, or to the in-memory stand-in where no address is set. */
async function send(request: { op: "push"; space: string; body: string } | { op: "pull"; space: string }): Promise<Answer> {
  const url = moveUrl();
  if (!url) {
    if (request.op === "push") {
      memorySpaces.set(request.space, request.body);
      return { ok: true };
    }
    const body = memorySpaces.get(request.space);
    memorySpaces.delete(request.space);
    return body === undefined ? { ok: false, reason: "missing" } : { ok: true, body };
  }
  try {
    // A plain string body is sent as text/plain, which the browser posts without asking first.
    const response = await fetch(url, { method: "POST", body: JSON.stringify(request), cache: "no-store", credentials: "omit" });
    const answer = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (answer?.ok === true) return { ok: true, ...(typeof answer.body === "string" ? { body: answer.body } : {}) };
    const reason = typeof answer?.reason === "string" ? answer.reason : "error";
    if (reason === "paused") paused = true;
    return { ok: false, reason };
  } catch {
    return { ok: false, reason: "error" };
  }
}

function problemFor(reason: string): MoveProblem {
  switch (reason) {
    case "missing": return "wrong-code";
    case "too-big": return "too-big";
    case "capped":
    case "throttled": return "busy";
    case "not-here": return "not-here";
    case "paused": return "paused";
    default: return "failed";
  }
}

function blocked(): MoveProblem | null {
  if (!cryptoAvailable()) return "no-crypto";
  if (paused) return "paused";
  return null;
}

/**
 * Snapshot, encrypt and hand over the whole database. Returns the code to show (grouped) and a link
 * carrying it. Nothing on this device changes. The code is not kept anywhere: show it now.
 */
export async function moveOut<Tables extends TableMap>(database: DatabaseHandle<Tables>): Promise<MoveOutResult> {
  const stop = blocked();
  if (stop) return { ok: false, reason: stop };
  try {
    const data = await snapshot(database);
    const code = codeFor();
    const body = await encrypt(JSON.stringify(data), code);
    if (body.length > MAX_BODY_CHARS) return { ok: false, reason: "too-big" };
    const answer = await send({ op: "push", space: await spaceIdFor(code), body });
    if (!answer.ok) return { ok: false, reason: problemFor(answer.reason) };
    const here = typeof location === "undefined" ? "" : `${location.origin}${location.pathname}`;
    return { ok: true, code: formatCode(code), link: `${here}#move=${code}`, leftOut: data.leftOut, tables: rowCounts(data.tables) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/**
 * Fetch, decrypt and check what a code carries, without changing anything here yet. WishWhip
 * deletes its copy as it hands it over, so keep `data` until the person decides; pass it to
 * `applyMove` to replace this device's data with it, and call `putBack` if that fails.
 *
 * A table that holds Blobs or other binary data on this device is never replaced, whatever arrives
 * for it: the move cannot carry such data, so replacing it would delete photos here. Such tables are
 * named in `leftOut` with the ones the other device left out.
 *
 * A copy fetched but not usable here (made by a newer version, by another app, or failing to load)
 * is handed back under the same code; `lost` says that failed too.
 */
export async function moveIn<Tables extends TableMap>(database: DatabaseHandle<Tables>, typed: string): Promise<MoveInResult> {
  const stop = blocked();
  if (stop) return { ok: false, reason: stop };
  const code = canonicalCode(typed);
  if (!code) return { ok: false, reason: "wrong-code" };
  let putBack: (() => Promise<boolean>) | undefined;
  // After a fetch, a refusal hands the copy back first, so the message stays true.
  const refuse = async (reason: MoveProblem): Promise<MoveInResult> => {
    if (!putBack) return { ok: false, reason };
    return (await putBack()) ? { ok: false, reason } : { ok: false, reason, lost: true };
  };
  try {
    const space = await spaceIdFor(code);
    const answer = await send({ op: "pull", space });
    if (!answer.ok) return { ok: false, reason: problemFor(answer.reason) };
    if (typeof answer.body !== "string") return { ok: false, reason: "failed" };
    const body = answer.body;
    const text = await decrypt(body, code);
    // Not this code's copy, or damaged: nothing worth handing back.
    if (text === null) return { ok: false, reason: "wrong-code" };
    putBack = async () => {
      try {
        return (await send({ op: "push", space, body })).ok;
      } catch {
        return false;
      }
    };
    let parsed: MoveSnapshot;
    try {
      parsed = parseExport(text, database) as MoveSnapshot;
    } catch (error) {
      if (error instanceof ImportError && error.reason === "newer-schema") return await refuse("newer-version");
      if (error instanceof ImportError && error.reason === "wrong-database") return await refuse("wrong-app");
      if (error instanceof ImportError) return { ok: false, reason: "wrong-code" };
      throw error;
    }
    const leftOut = Array.isArray(parsed.leftOut) ? parsed.leftOut.filter((name): name is string => typeof name === "string") : [];
    const tables = { ...parsed.tables };
    const local = await database.ready();
    for (const name of Object.keys(tables)) {
      if (!database.tableNames.includes(name)) continue;
      if (await local.table(name).filter((row) => holdsBinary(row)).first()) {
        delete tables[name];
        if (!leftOut.includes(name)) leftOut.push(name);
      }
    }
    const data: MoveSnapshot = { ...parsed, tables, leftOut };
    return { ok: true, data, leftOut, tables: rowCounts(tables, database.tableNames), putBack };
  } catch {
    return await refuse("failed");
  }
}

/**
 * Replace this device's data with what `moveIn` returned: every moved table is emptied and refilled
 * in one transaction. Tables left out of the move (photos and other files) keep what they had.
 */
export async function applyMove<Tables extends TableMap>(database: DatabaseHandle<Tables>, data: MoveSnapshot): Promise<ImportResult> {
  return importDatabase(database, data, { mode: "replace" });
}
