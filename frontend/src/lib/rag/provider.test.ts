import { describe, expect, it } from "vitest";
import { normalizeIndexedEmbeddings } from "./provider";

const vector = () => Array(1024).fill(0.1);

describe("embedding response order", () => {
  it("restores input order from provider indexes", () => {
    const second = vector(); second[0] = 0.2;
    expect(normalizeIndexedEmbeddings([{ index: 1, embedding: second }, { index: 0, embedding: vector() }], 2))
      .toEqual([vector(), second]);
  });
  it("rejects missing, duplicate, and malformed vectors", () => {
    expect(() => normalizeIndexedEmbeddings([{ index: 0, embedding: vector() }], 2)).toThrow();
    expect(() => normalizeIndexedEmbeddings([{ index: 0, embedding: vector() }, { index: 0, embedding: vector() }], 2)).toThrow();
    expect(() => normalizeIndexedEmbeddings([{ index: 0, embedding: [0.1] }], 1)).toThrow();
  });
});
