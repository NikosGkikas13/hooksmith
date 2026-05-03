import { describe, it, expect } from "vitest";

import { isPrivateIp, parseSafeUrl, SsrfError } from "./ssrf";

describe("isPrivateIp", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254", // AWS/GCP/Azure metadata
    "172.16.5.6",
    "172.31.255.255",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
  ])("rejects private IPv4 %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(["1.1.1.1", "8.8.8.8", "151.101.1.1", "172.32.0.1", "100.128.0.1"])(
    "allows public IPv4 %s",
    (ip) => {
      expect(isPrivateIp(ip)).toBe(false);
    },
  );

  it.each([
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
  ])("rejects private IPv6 %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(["2606:4700:4700::1111", "2001:4860:4860::8888"])(
    "allows public IPv6 %s",
    (ip) => {
      expect(isPrivateIp(ip)).toBe(false);
    },
  );

  it("rejects unparseable input", () => {
    expect(isPrivateIp("not-an-ip")).toBe(true);
    expect(isPrivateIp("999.999.999.999")).toBe(true);
  });
});

describe("parseSafeUrl", () => {
  it("accepts a normal https URL", () => {
    const url = parseSafeUrl("https://api.example.com/hook");
    expect(url.hostname).toBe("api.example.com");
  });

  it("accepts http (some users have HTTP-only sinks)", () => {
    expect(() => parseSafeUrl("http://example.com/")).not.toThrow();
  });

  it.each([
    "ftp://example.com/",
    "file:///etc/passwd",
    "gopher://example.com/",
    "javascript:alert(1)",
  ])("rejects scheme %s", (raw) => {
    expect(() => parseSafeUrl(raw)).toThrow(SsrfError);
  });

  it("rejects credentials in URL", () => {
    expect(() => parseSafeUrl("https://user:pw@example.com/")).toThrow(
      SsrfError,
    );
  });

  it.each([
    "http://127.0.0.1/",
    "http://10.0.0.5/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[fe80::1]/",
  ])("rejects private IP literal %s", (raw) => {
    expect(() => parseSafeUrl(raw)).toThrow(SsrfError);
  });

  it("does not resolve DNS — hostnames pass parseSafeUrl", () => {
    // localhost would be caught at the DNS step in assertSafeUrl, but the
    // sync parser only inspects literal IPs.
    expect(() => parseSafeUrl("http://localhost/")).not.toThrow();
  });

  it("rejects malformed URLs", () => {
    expect(() => parseSafeUrl("not a url")).toThrow(SsrfError);
  });
});
