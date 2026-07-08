import { expect, test, describe, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import {
  isRemoteUrl,
  toRawUrl,
  fetchRemote,
  cleanupRemote,
} from "./remote";
import { clearAllCache, getCachedContent } from "./cache";

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
const remotePaths: string[] = [];

beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("---\ndescription: local remote fixture\n---\nHello\n"),
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

function remember(result: Awaited<ReturnType<typeof fetchRemote>>) {
  if (result.localPath && result.isRemote) remotePaths.push(result.localPath);
  return result;
}

describe("isRemoteUrl", () => {
  test("returns true for http URL", () => {
    expect(isRemoteUrl("http://example.com/file.md")).toBe(true);
  });

  test("returns true for https URL", () => {
    expect(isRemoteUrl("https://example.com/file.md")).toBe(true);
  });

  test("returns false for local path", () => {
    expect(isRemoteUrl("./DEMO.md")).toBe(false);
  });

  test("returns false for absolute path", () => {
    expect(isRemoteUrl("/home/user/file.md")).toBe(false);
  });

  test("returns false for relative path", () => {
    expect(isRemoteUrl("instructions/DEMO.md")).toBe(false);
  });
});

describe("toRawUrl", () => {
  test("converts GitHub Gist URL to raw", () => {
    const url = "https://gist.github.com/user/abc123def456";
    const raw = toRawUrl(url);
    expect(raw).toBe("https://gist.githubusercontent.com/user/abc123def456/raw");
  });

  test("converts GitHub blob URL to raw", () => {
    const url = "https://github.com/user/repo/blob/main/scripts/deploy.md";
    const raw = toRawUrl(url);
    expect(raw).toBe("https://raw.githubusercontent.com/user/repo/main/scripts/deploy.md");
  });

  test("converts GitLab blob URL to raw", () => {
    const url = "https://gitlab.com/user/repo/-/blob/main/file.md";
    const raw = toRawUrl(url);
    expect(raw).toBe("https://gitlab.com/user/repo/-/raw/main/file.md");
  });

  test("returns unchanged URL for already raw content", () => {
    const url = "https://raw.githubusercontent.com/user/repo/main/file.md";
    const raw = toRawUrl(url);
    expect(raw).toBe(url);
  });

  test("returns unchanged URL for unknown sources", () => {
    const url = "https://example.com/file.md";
    const raw = toRawUrl(url);
    expect(raw).toBe(url);
  });
});

describe("fetchRemote", () => {
  test("returns isRemote: false for local paths", async () => {
    const result = await fetchRemote("./local/path.md");
    expect(result.isRemote).toBe(false);
    expect(result.success).toBe(true);
    expect(result.localPath).toBe("./local/path.md");
  });

  test("returns isRemote: true for http URLs", async () => {
    const result = await fetchRemote(`${baseUrl}/file.md`, { noCache: true });
    try {
      expect(result.isRemote).toBe(true);
      expect(result.success).toBe(true);
    } finally {
      if (result.localPath) await cleanupRemote(result.localPath);
    }
  });
});

describe("fetchRemote caching", () => {
  // Clean up cache before and after tests
  beforeEach(async () => {
    await clearAllCache();
  });

  afterEach(async () => {
    await clearAllCache();
    await Promise.all(remotePaths.splice(0).map((path) => cleanupRemote(path)));
  });

  test("caches fetched content", async () => {
    const url = `${baseUrl}/cache.md`;
    const result = remember(await fetchRemote(url));

    expect(result.success).toBe(true);
    expect(result.fromCache).toBe(false);

    const cached = await getCachedContent(toRawUrl(url));
    expect(cached.hit).toBe(true);
  });

  test("returns cached content on second fetch", async () => {
    const url = `${baseUrl}/second.md`;

    // First fetch - should not be from cache
    const result1 = remember(await fetchRemote(url));
    expect(result1.fromCache).toBe(false);

    // Second fetch - should be from cache
    const result2 = remember(await fetchRemote(url));
    expect(result2.success).toBe(true);
    expect(result2.fromCache).toBe(true);
  });

  test("bypasses cache with noCache option", async () => {
    const url = `${baseUrl}/bypass.md`;

    // First fetch - populate cache
    const result1 = remember(await fetchRemote(url));
    expect(result1.success).toBe(true);

    // Second fetch with noCache - should not use cache
    const result2 = remember(await fetchRemote(url, { noCache: true }));
    expect(result2.success).toBe(true);
    expect(result2.fromCache).toBe(false);
  });
});
