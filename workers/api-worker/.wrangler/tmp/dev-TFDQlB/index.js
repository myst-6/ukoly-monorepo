var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-Hwlg75/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// .wrangler/tmp/bundle-Hwlg75/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// src/rate-limiter.ts
var RateLimiter = class {
  state;
  env;
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/check") {
      return this.checkRateLimit();
    }
    return new Response("Not found", { status: 404 });
  }
  async checkRateLimit() {
    const now = Date.now();
    const windowMs = 60 * 1e3;
    const maxRequests = 5;
    let requests = await this.state.storage.get("requests") || [];
    requests = requests.filter(
      (timestamp) => now - timestamp < windowMs
    );
    if (requests.length >= maxRequests) {
      const oldestRequest = requests[0];
      const retryAfter = Math.ceil((oldestRequest + windowMs - now) / 1e3);
      return new Response("Rate limit exceeded", {
        status: 429,
        headers: {
          "Retry-After": retryAfter.toString(),
          "X-RateLimit-Limit": maxRequests.toString(),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": new Date(oldestRequest + windowMs).toISOString()
        }
      });
    }
    requests.push(now);
    await this.state.storage.put("requests", requests);
    return new Response("OK", {
      status: 200,
      headers: {
        "X-RateLimit-Limit": maxRequests.toString(),
        "X-RateLimit-Remaining": (maxRequests - requests.length).toString(),
        "X-RateLimit-Reset": new Date(now + windowMs).toISOString()
      }
    });
  }
};
__name(RateLimiter, "RateLimiter");

// src/index.ts
var src_default = {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "http://localhost:5173",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Secret-Token"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowedOrigins = [
      "http://localhost:5173",
      "https://yourdomain.com"
      // for production
    ];
    if (!allowedOrigins.includes(origin || "")) {
      return new Response("Forbidden", {
        status: 403,
        headers: corsHeaders
      });
    }
    const secretToken = request.headers.get("X-Secret-Token");
    if (secretToken !== env.SECRET_TOKEN) {
      return new Response("Unauthorized", {
        status: 401,
        headers: corsHeaders
      });
    }
    if (url.pathname === "/api/execute" && request.method === "POST") {
      return this.handleCodeExecution(request, env, corsHeaders);
    }
    return new Response("Not found", {
      status: 404,
      headers: corsHeaders
    });
  },
  async handleCodeExecution(request, env, corsHeaders) {
    try {
      const rateLimitResponse = await this.checkRateLimit(request, env);
      if (rateLimitResponse.status !== 200) {
        return new Response(rateLimitResponse.body, {
          status: rateLimitResponse.status,
          headers: {
            ...corsHeaders,
            ...Object.fromEntries(rateLimitResponse.headers)
          }
        });
      }
      const body = await request.json();
      if (!body.code || !body.language || !body.testCases) {
        return new Response("Invalid request", {
          status: 400,
          headers: corsHeaders
        });
      }
      if (body.language !== "javascript") {
        return new Response("Only JavaScript is supported for now", {
          status: 400,
          headers: corsHeaders
        });
      }
      const results = [];
      for (let i = 0; i < body.testCases.length; i++) {
        const testCase = body.testCases[i];
        const result = await this.executeJavaScript(body.code, testCase);
        results.push({
          testCaseIndex: i,
          ...result
        });
      }
      return new Response(JSON.stringify({ results }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    } catch (error) {
      console.error("Error handling code execution:", error);
      return new Response("Internal server error", {
        status: 500,
        headers: corsHeaders
      });
    }
  },
  async checkRateLimit(request, env) {
    const clientIP = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
    const rateLimiterId = env.RATE_LIMITER.idFromName(clientIP);
    const rateLimiter = env.RATE_LIMITER.get(rateLimiterId);
    return rateLimiter.fetch(new Request("http://dummy/check"));
  },
  async executeJavaScript(code, testCase) {
    const startTime = Date.now();
    try {
      const sandbox = {
        console: {
          log: (...args) => {
            if (!sandbox.stdout)
              sandbox.stdout = "";
            sandbox.stdout += args.join(" ") + "\n";
          }
        },
        stdout: "",
        stderr: "",
        process: {
          stdin: testCase.stdin
        }
      };
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("Time limit exceeded")),
          testCase.timeLimit
        );
      });
      const executionPromise = new Promise((resolve, reject) => {
        try {
          const func = new Function("console", "process", code);
          func(sandbox.console, sandbox.process);
          resolve(sandbox);
        } catch (error) {
          reject(error);
        }
      });
      const result = await Promise.race([
        executionPromise,
        timeoutPromise
      ]);
      const endTime = Date.now();
      const executionTime = endTime - startTime;
      return {
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        exitCode: 0,
        maxMemoryUsed: 0,
        // Not implemented yet
        executionTime,
        timedOut: false,
        memoryExceeded: false
      };
    } catch (error) {
      const endTime = Date.now();
      const executionTime = endTime - startTime;
      return {
        stdout: "",
        stderr: error instanceof Error ? error.message : "Unknown error",
        exitCode: 1,
        maxMemoryUsed: 0,
        executionTime,
        timedOut: error instanceof Error && error.message === "Time limit exceeded",
        memoryExceeded: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
};

// ../../node_modules/.pnpm/wrangler@3.114.11_@cloudflare+workers-types@4.20250726.0/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../node_modules/.pnpm/wrangler@3.114.11_@cloudflare+workers-types@4.20250726.0/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-Hwlg75/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../node_modules/.pnpm/wrangler@3.114.11_@cloudflare+workers-types@4.20250726.0/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-Hwlg75/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  RateLimiter,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
