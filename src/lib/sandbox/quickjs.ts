import {
  getQuickJS,
  type QuickJSContext,
  type QuickJSWASMModule,
} from "quickjs-emscripten";

/**
 * Sandbox for running user-authored transformation code.
 *
 * Constraints:
 *  - No network, no filesystem, no timers beyond the host timeout.
 *  - Memory capped via QuickJS runtime limits.
 *  - Execution capped at `timeoutMs` wall-clock.
 *  - Input: a single JSON value (parsed event payload).
 *  - Output: any JSON-serializable value returned by the user function.
 *
 * The user code is wrapped so their source is just the *body* of:
 *
 *   (event) => { ... }
 *
 * i.e. the input source looks like: `return { ... };` or `event.foo;`.
 * Full function expressions are also accepted.
 */

let _qjs: QuickJSWASMModule | null = null;

async function getQjs(): Promise<QuickJSWASMModule> {
  if (!_qjs) _qjs = await getQuickJS();
  return _qjs;
}

export type SandboxResult =
  | { ok: true; value: unknown; durationMs: number }
  | { ok: false; error: string; durationMs: number };

const DEFAULT_TIMEOUT_MS = 250;
const DEFAULT_MEMORY_BYTES = 16 * 1024 * 1024; // 16 MB
const DEFAULT_STACK_BYTES = 256 * 1024; // 256 KB

/**
 * Run user JS against a parsed event payload. Returns either the transformed
 * value or a structured error. Never throws for user code bugs — only for
 * host-level failures.
 */
export async function runTransformation(
  codeJs: string,
  event: unknown,
  opts: {
    timeoutMs?: number;
    memoryBytes?: number;
    stackBytes?: number;
  } = {},
): Promise<SandboxResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const memoryBytes = opts.memoryBytes ?? DEFAULT_MEMORY_BYTES;
  const stackBytes = opts.stackBytes ?? DEFAULT_STACK_BYTES;

  const qjs = await getQjs();
  const rt = qjs.newRuntime();
  rt.setMemoryLimit(memoryBytes);
  rt.setMaxStackSize(stackBytes);

  const deadline = Date.now() + timeoutMs;
  rt.setInterruptHandler(() => Date.now() > deadline);

  const ctx = rt.newContext();
  const started = Date.now();

  try {
    // Expose the event as a global JSON blob to avoid marshaling complexity.
    const payload = JSON.stringify(event);
    ctx.setProp(
      ctx.global,
      "__HS_EVENT_JSON__",
      ctx.newString(payload),
    );

    // Wrap user code into a callable. We accept either a raw function body
    // (expression or statements ending in `return`) or a full arrow fn / fn expression.
    const script = `
      (() => {
        const event = JSON.parse(globalThis.__HS_EVENT_JSON__);
        const __user__ = (function() {
          "use strict";
          const __u = ${codeJs};
          if (typeof __u === "function") return __u;
          return (e) => {
            ${codeJs}
          };
        })();
        const out = __user__(event);
        return JSON.stringify(out === undefined ? null : out);
      })();
    `;

    const result = ctx.evalCode(script, "transform.js");
    if (result.error) {
      const errStr = ctx.dump(result.error);
      result.error.dispose();
      return {
        ok: false,
        error: typeof errStr === "string" ? errStr : JSON.stringify(errStr),
        durationMs: Date.now() - started,
      };
    }

    const raw = ctx.getString(result.value);
    result.value.dispose();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        error: "transformation did not return JSON-serializable value",
        durationMs: Date.now() - started,
      };
    }
    return {
      ok: true,
      value: parsed,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Interrupt shows up as a runtime error — surface it as a timeout.
    const isTimeout = /interrupted/i.test(msg);
    return {
      ok: false,
      error: isTimeout
        ? `transformation timed out after ${timeoutMs}ms`
        : msg,
      durationMs: Date.now() - started,
    };
  } finally {
    ctx.dispose();
    rt.dispose();
  }
}
