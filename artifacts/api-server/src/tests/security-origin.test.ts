import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  allowedOrigins,
  isExactAllowedOrigin,
} from "../lib/security";

const originalEnvironment = {
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
  REPLIT_DOMAINS: process.env.REPLIT_DOMAINS,
  REPLIT_DEV_DOMAIN: process.env.REPLIT_DEV_DOMAIN,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("production origin allowlist", () => {
  it("accepts exact Replit runtime domains and rejects lookalikes", () => {
    delete process.env.ALLOWED_ORIGINS;
    delete process.env.WEB_ORIGIN;
    process.env.REPLIT_DEV_DOMAIN = "development-example.replit.dev";
    process.env.REPLIT_DOMAINS =
      "al-kabir-islamic-challenge-design.replit.app, custom.example.org";

    const origins = allowedOrigins();

    assert.ok(
      origins.includes(
        "https://al-kabir-islamic-challenge-design.replit.app",
      ),
    );
    assert.ok(origins.includes("https://custom.example.org"));
    assert.ok(origins.includes("https://development-example.replit.dev"));
    assert.equal(
      isExactAllowedOrigin(
        "https://al-kabir-islamic-challenge-design.replit.app",
        origins,
      ),
      true,
    );
    assert.equal(
      isExactAllowedOrigin(
        "https://al-kabir-islamic-challenge-design.replit.app.attacker.test",
        origins,
      ),
      false,
    );
  });

  it("normalizes configured trailing slashes without broad matching", () => {
    process.env.ALLOWED_ORIGINS = "https://community.example.com/";
    delete process.env.WEB_ORIGIN;
    delete process.env.REPLIT_DOMAINS;
    delete process.env.REPLIT_DEV_DOMAIN;

    const origins = allowedOrigins();

    assert.equal(
      isExactAllowedOrigin("https://community.example.com/", origins),
      true,
    );
    assert.equal(
      isExactAllowedOrigin("https://sub.community.example.com", origins),
      false,
    );
  });
});