import { describe, it, expect } from "vitest";
import { MapAgentRegistry } from "@ai-review/agent-runtime";
import { reviewHandler } from "./review.js";

const DIFF = `--- a/app/util.py
+++ b/app/util.py
@@ -1,2 +1,5 @@
 print("old line")
+import pickle
+data = pickle.loads(blob)
+print(data)
--- a/Dockerfile
+++ b/Dockerfile
@@ -0,0 +1,1 @@
+FROM node:latest
`;

describe("reviewHandler rules-only mode", () => {
  it("reviews multiple languages without any AI provider or specialist", async () => {
    const res = await reviewHandler(
      { diff: DIFF, selectedSpecialists: [], env: { AI_REVIEW_LLM_PROVIDER: "mock" } },
      new MapAgentRegistry(),
    );
    expect(res.mode).toBe("rules-only");
    expect(res.errors).toHaveLength(0);
    expect(res.metrics).toMatchObject({ cacheHits: 0, cacheMisses: 0 });
    const found = res.issues.map((i) => `${i.location.file}:${i.title}`);
    expect(found).toEqual(
      expect.arrayContaining([
        "app/util.py:py.unsafe-deserialization",
        "app/util.py:py.no-print",
        "Dockerfile:docker.latest-tag",
      ]),
    );
    // the unchanged context line (line 1) is not reported
    expect(res.issues.some((i) => i.location.line === 1 && i.location.file === "app/util.py")).toBe(false);
  });
});
