import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const origin = "https://cash.example";
const workerSource = readFileSync(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);

function serviceWorkerEnvironment() {
  let serverVersion = "11111111";
  let offline = false;
  let htmlAsset = false;
  let varyOrigin = false;
  const entries = new Map<string, Map<string, Response>>();
  const cachedRequestHeaders = new Map<string, Map<string, Headers>>();
  const cacheKey = (request: Request | string) =>
    new URL(typeof request === "string" ? request : request.url, origin).href;
  const fetch = vi.fn(async (request: Request | string) => {
    if (offline) throw new TypeError("Offline");
    const pathname = new URL(cacheKey(request)).pathname;
    if (pathname === "/" || pathname === "/index.html") {
      return new Response(
        `<!doctype html><html>shell ${serverVersion}</html>`,
        {
          headers: {
            "Content-Type": "text/html",
            ...(varyOrigin ? { Vary: "Origin" } : {}),
          },
        },
      );
    }
    if (htmlAsset || !pathname.includes(serverVersion)) {
      return new Response("<!doctype html><html>SPA fallback</html>", {
        headers: {
          "Content-Type": "text/html",
          ...(varyOrigin ? { Vary: "Origin" } : {}),
        },
      });
    }
    return new Response(`asset ${serverVersion}`, {
      headers: {
        "Content-Type": pathname.endsWith(".css")
          ? "text/css"
          : "application/javascript",
        ...(varyOrigin ? { Vary: "Origin" } : {}),
      },
    });
  });
  const caches = {
    async open(name: string) {
      if (!entries.has(name)) entries.set(name, new Map());
      if (!cachedRequestHeaders.has(name))
        cachedRequestHeaders.set(name, new Map());
      const contents = entries.get(name)!;
      const storedHeaders = cachedRequestHeaders.get(name)!;
      return {
        async match(
          request: Request | string,
          options: CacheQueryOptions = {},
        ) {
          const key = cacheKey(request);
          const response = contents.get(key);
          if (!response) return;
          if (!options.ignoreVary) {
            const incoming = new Headers(
              typeof request === "string" ? undefined : request.headers,
            );
            const cachedHeaders = storedHeaders.get(key) ?? new Headers();
            for (const header of (response.headers.get("Vary") ?? "")
              .split(",")
              .map((header) => header.trim())
              .filter(Boolean)) {
              if (
                header === "*" ||
                incoming.get(header) !== cachedHeaders.get(header)
              )
                return;
            }
          }
          return response.clone();
        },
        async addAll(requests: Request[]) {
          // Match the browser API's all-or-nothing batch before exposing entries.
          const responses = await Promise.all(
            requests.map(
              async (request) =>
                [cacheKey(request), await fetch(request)] as const,
            ),
          );
          for (const [key, response] of responses) contents.set(key, response);
          for (const request of requests)
            storedHeaders.set(cacheKey(request), new Headers(request.headers));
        },
      };
    },
    async keys() {
      return [...entries.keys()];
    },
    async delete(name: string) {
      return entries.delete(name);
    },
  };
  const claim = vi.fn(async () => undefined);
  const skipWaiting = vi.fn();

  function worker(version: string) {
    const listeners = new Map<string, (event: any) => void>();
    const code = workerSource
      .replace(
        /\/\* CASH_TRACKER_VERSION \*\/\s*"local"/,
        JSON.stringify(version),
      )
      .replace(
        /\/\* CASH_TRACKER_PRECACHE \*\/\s*\[[^\]]*\]/,
        JSON.stringify([
          "/",
          "/index.html",
          `/assets/index-${version}.js`,
          `/assets/index-${version}.css`,
        ]),
      );
    const self = {
      location: { origin },
      clients: { claim },
      skipWaiting,
      addEventListener(name: string, callback: (event: any) => void) {
        listeners.set(name, callback);
      },
    };
    const RelativeRequest = class extends Request {
      constructor(url: string, options?: RequestInit) {
        super(new URL(url, origin), options);
      }
    };
    runInNewContext(code, {
      self,
      caches,
      Request: RelativeRequest,
      Response,
      URL,
      fetch,
    });
    return {
      async event(name: string) {
        let work: Promise<unknown> | undefined;
        listeners.get(name)!({
          waitUntil(promise: Promise<unknown>) {
            work = promise;
          },
        });
        await work;
      },
      async request(
        path: string,
        mode = "cors",
        method = "GET",
        headers: Record<string, string> = {},
      ): Promise<Response | undefined> {
        let response: Promise<Response> | undefined;
        listeners.get("fetch")!({
          request: {
            url: new URL(path, origin).href,
            mode,
            method,
            headers: new Headers(headers),
          },
          respondWith(promise: Promise<Response>) {
            response = promise;
          },
        });
        return response;
      },
      message(data: string) {
        listeners.get("message")!({ data });
      },
    };
  }
  return {
    worker,
    caches,
    fetch,
    claim,
    skipWaiting,
    entries,
    server(version: string) {
      serverVersion = version;
    },
    goOffline() {
      offline = true;
    },
    serveHtmlAsset() {
      htmlAsset = true;
    },
    varyByOrigin() {
      varyOrigin = true;
    },
  };
}

describe("service worker durante atualização", () => {
  it("serve módulos e CSS com Origin diferente do precache mesmo quando o servidor responde Vary: Origin", async () => {
    const environment = serviceWorkerEnvironment();
    environment.varyByOrigin();
    const first = environment.worker("11111111");
    await first.event("install");
    await first.event("activate");
    const actualModuleRequest = new Request(
      `${origin}/assets/index-11111111.js`,
      { headers: { Origin: origin } },
    );
    const cache = await environment.caches.open("cash-tracker-app-11111111");
    expect(await cache.match(actualModuleRequest)).toBeUndefined();
    environment.goOffline();
    const before = environment.fetch.mock.calls.length;
    expect(
      await (await first.request("/assets/index-11111111.js", "cors", "GET", {
        Origin: origin,
      }))!.text(),
    ).toBe("asset 11111111");
    expect(
      await (await first.request("/assets/index-11111111.css", "cors", "GET", {
        Origin: origin,
      }))!.text(),
    ).toBe("asset 11111111");
    expect(environment.fetch.mock.calls.length).toBe(before);
    expect(
      (await first.request(
        "/assets/index-11111111.js?different=1",
        "cors",
        "GET",
        { Origin: origin },
      ))!.status,
    ).toBe(503);
  });

  it("usa o cache predecessor por URL exata com Origin diferente durante a troca de versão", async () => {
    const environment = serviceWorkerEnvironment();
    environment.varyByOrigin();
    const first = environment.worker("11111111");
    await first.event("install");
    await first.event("activate");
    environment.server("22222222");
    const second = environment.worker("22222222");
    await second.event("install");
    await second.event("activate");
    environment.goOffline();
    const before = environment.fetch.mock.calls.length;
    expect(
      await (await second.request("/assets/index-11111111.js", "cors", "GET", {
        Origin: origin,
      }))!.text(),
    ).toBe("asset 11111111");
    expect(
      await (await second.request("/assets/index-11111111.css", "cors", "GET", {
        Origin: origin,
      }))!.text(),
    ).toBe("asset 11111111");
    expect(environment.fetch.mock.calls.length).toBe(before);
    expect(await (await second.request("/", "navigate"))!.text()).toContain(
      "shell 22222222",
    );
  });

  it("mantém shell antiga durante espera e serve seus assets após ativar a nova versão offline", async () => {
    const environment = serviceWorkerEnvironment();
    const first = environment.worker("11111111");
    await first.event("install");
    await first.event("activate");
    environment.server("22222222");
    const second = environment.worker("22222222");
    await second.event("install");
    expect(environment.skipWaiting).not.toHaveBeenCalled();
    expect(await (await first.request("/", "navigate"))!.text()).toContain(
      "shell 11111111",
    );

    second.message("SKIP_WAITING");
    await second.event("activate");
    environment.goOffline();
    expect(await (await second.request("/", "navigate"))!.text()).toContain(
      "shell 22222222",
    );
    expect(
      await (await second.request("/assets/index-11111111.js"))!.text(),
    ).toBe("asset 11111111");
    expect(
      await (await second.request("/assets/index-11111111.css"))!.text(),
    ).toBe("asset 11111111");
    expect(
      await (await second.request("/assets/index-22222222.js"))!.text(),
    ).toBe("asset 22222222");
  });

  it("conserva apenas a versão atual e dois predecessores completos", async () => {
    const environment = serviceWorkerEnvironment();
    for (const version of ["11111111", "22222222", "33333333", "44444444"]) {
      environment.server(version);
      const worker = environment.worker(version);
      await worker.event("install");
      await worker.event("activate");
    }
    expect(await environment.caches.keys()).toEqual([
      "cash-tracker-app-22222222",
      "cash-tracker-app-33333333",
      "cash-tracker-app-44444444",
    ]);
  });

  it("falha a instalação e descarta o candidato quando JS/CSS recebe fallback HTML", async () => {
    const environment = serviceWorkerEnvironment();
    const first = environment.worker("11111111");
    await first.event("install");
    await first.event("activate");
    environment.server("22222222");
    environment.serveHtmlAsset();
    await expect(
      environment.worker("22222222").event("install"),
    ).rejects.toThrow(/HTML|página/);
    expect(await environment.caches.keys()).toEqual([
      "cash-tracker-app-11111111",
    ]);
    environment.goOffline();
    expect(
      await (await first.request("/assets/index-11111111.js"))!.text(),
    ).toBe("asset 11111111");
  });

  it("não usa caches anteriores para HTML ou URLs diferentes nem retorna fallback HTML para arquivo ausente", async () => {
    const environment = serviceWorkerEnvironment();
    const first = environment.worker("11111111");
    await first.event("install");
    await first.event("activate");
    expect((await first.request("/assets/missing-00000000.js"))!.status).toBe(
      404,
    );
    environment.goOffline();
    expect(
      (await first.request("/assets/index-11111111.js?different=1"))!.status,
    ).toBe(503);
    expect((await first.request("/assets/unknown-00000000.js"))!.status).toBe(
      503,
    );
    expect(
      await first.request("https://another.example/asset.js"),
    ).toBeUndefined();
    expect(
      await first.request("/assets/index-11111111.js", "cors", "POST"),
    ).toBeUndefined();
  });
});

class FakeInstallingWorker extends EventTarget {
  state: ServiceWorkerState = "installing";
  installed() {
    this.state = "installed";
    this.dispatchEvent(new Event("statechange"));
  }
}
class FakeRegistration extends EventTarget {
  installing: FakeInstallingWorker | null = null;
  waiting: FakeInstallingWorker | null = null;
}
class FakeServiceWorkers extends EventTarget {
  controller: object | null = null;
  constructor(public registration: FakeRegistration) {
    super();
  }
  register = vi.fn(async () => this.registration);
  changeController() {
    this.controller = {};
    this.dispatchEvent(new Event("controllerchange"));
  }
}

async function registrationEnvironment(controlled = false) {
  vi.resetModules();
  vi.stubEnv("PROD", true);
  const registration = new FakeRegistration();
  const container = new FakeServiceWorkers(registration);
  if (controlled) container.controller = {};
  const reload = vi.fn();
  vi.stubGlobal("navigator", { serviceWorker: container });
  vi.stubGlobal("document", { readyState: "complete" });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("location", { reload });
  const api = await import("./pwa");
  return { registration, container, reload, api };
}

describe("registro PWA", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("avisa uma atualização já aguardando ativação", async () => {
    const environment = await registrationEnvironment(true);
    environment.registration.waiting = new FakeInstallingWorker();
    environment.registration.waiting.state = "installed";
    const onUpdate = vi.fn();
    expect(await environment.api.registerPwa({ onUpdate })).toBe(
      environment.registration,
    );
    expect(onUpdate).toHaveBeenCalledWith(environment.registration);
  });

  it("observa instalação que começou antes de register resolver", async () => {
    const environment = await registrationEnvironment(true);
    environment.registration.installing = new FakeInstallingWorker();
    const onUpdate = vi.fn();
    await environment.api.registerPwa({ onUpdate });
    environment.registration.installing.installed();
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith(environment.registration);
  });

  it("informa primeiro precache e só recarrega após mudança de um controlador já existente", async () => {
    const environment = await registrationEnvironment();
    environment.registration.installing = new FakeInstallingWorker();
    const onOfflineReady = vi.fn();
    await environment.api.registerPwa({ onOfflineReady });
    environment.registration.installing.installed();
    expect(onOfflineReady).toHaveBeenCalledOnce();
    environment.container.changeController();
    expect(environment.reload).not.toHaveBeenCalled();
    environment.container.changeController();
    expect(environment.reload).toHaveBeenCalledOnce();
  });

  it("recarrega na atualização natural mesmo sem clicar em Atualizar e registra um único listener global", async () => {
    const environment = await registrationEnvironment(true);
    await environment.api.registerPwa();
    await environment.api.registerPwa();
    environment.container.changeController();
    expect(environment.reload).toHaveBeenCalledOnce();
  });
});
