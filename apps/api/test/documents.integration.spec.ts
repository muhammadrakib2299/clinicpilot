import { EMBEDDING_DIMENSIONS, SearchDocumentsInput } from "@clinicpilot/shared-types";

import { AuditService } from "../src/audit/audit.service";
import { runWithActor } from "../src/common/request-context";
import { DEMO_TENANT_ID, SECOND_TENANT_ID } from "../src/common/tenant";
import { DbService } from "../src/db/db.service";
import { DocumentsService } from "../src/documents/documents.service";

/**
 * Retrieval, against a real Postgres with a real pgvector extension.
 *
 * Not a unit test with a stubbed database, because every behaviour worth
 * checking here *is* the database: whether `<=>` orders the way the code
 * assumes, whether the model filter actually excludes rows, whether a
 * re-ingest replaces chunks or accumulates them, and whether RLS keeps one
 * clinic's corpus out of another's search. A mocked Drizzle would confirm the
 * queries were built, which is the part that was never in doubt.
 *
 *   pnpm up:infra && pnpm db:migrate && pnpm db:rls && pnpm db:seed
 *   pnpm test:integration
 */

jest.setTimeout(30_000);

let db: DbService;
let documents: DocumentsService;

const MODEL = "test-embedder-1";

/**
 * A unit vector pointing along one axis.
 *
 * Deliberately synthetic rather than run through the real embedder: this suite
 * is asserting that Postgres ranks by cosine distance, and hand-built vectors
 * make the expected order arithmetic rather than a property of English.
 */
function axis(index: number): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  vector[index] = 1;
  return vector;
}

/** Two axes at 45°, so it sits between them and closer to neither. */
function between(first: number, second: number): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  vector[first] = Math.SQRT1_2;
  vector[second] = Math.SQRT1_2;
  return vector;
}

const chunk = (ordinal: number, text: string, embedding: number[]) => ({
  ordinal,
  heading: `Section ${ordinal}`,
  text,
  embedding,
});

/** Every test ingests under its own slug, so they cannot see each other. */
async function ingest(tenantId: string, slug: string, chunks: ReturnType<typeof chunk>[]) {
  return documents.ingest(tenantId, {
    slug,
    title: `Title for ${slug}`,
    source: `test/${slug}.md`,
    embeddingModel: MODEL,
    chunks,
  });
}

/**
 * Search with the defaults the validation pipe would have applied.
 *
 * The service takes the *parsed* input, so every field is present by the time
 * it reaches it. Repeating `embeddingModel`, `limit` and `minScore` in a dozen
 * tests would bury the one value each of them is actually about — and parsing
 * here rather than hand-filling them means the defaults under test are the
 * real ones.
 */
function search(tenantId: string, query: Partial<SearchDocumentsInput> & { embedding: number[] }) {
  return documents.search(
    tenantId,
    SearchDocumentsInput.parse({ embeddingModel: MODEL, ...query }),
  );
}

beforeAll(() => {
  db = new DbService();
  documents = new DocumentsService(db, new AuditService(db));
});

afterAll(async () => {
  // Leaves no rows behind: the RLS suite counts what it finds, and a stray
  // document would make a later run's assertions depend on this one.
  await db.withTenant(DEMO_TENANT_ID, (tx) =>
    tx.execute(`delete from documents where source like 'test/%'`),
  );
  await db.withTenant(SECOND_TENANT_ID, (tx) =>
    tx.execute(`delete from documents where source like 'test/%'`),
  );
  await db.onModuleDestroy();
});

describe("ingest", () => {
  it("stores a document and reports what it wrote", async () => {
    const summary = await ingest(DEMO_TENANT_ID, "test-store", [
      chunk(1, "first passage", axis(0)),
      chunk(2, "second passage", axis(1)),
    ]);

    expect(summary.slug).toBe("test-store");
    expect(summary.chunkCount).toBe(2);
    expect(summary.embeddingModel).toBe(MODEL);
  });

  it("replaces a document's passages rather than adding to them", async () => {
    // The failure this prevents is silent: old passages would stay in the
    // index, rank against the new ones, and let the agent cite text that is
    // no longer in the document.
    await ingest(DEMO_TENANT_ID, "test-replace", [
      chunk(1, "the old wording", axis(2)),
      chunk(2, "also removed", axis(3)),
    ]);
    await ingest(DEMO_TENANT_ID, "test-replace", [chunk(1, "the new wording", axis(2))]);

    const hits = await search(DEMO_TENANT_ID, {
      embedding: axis(2),
      limit: 10,
    });

    const fromDocument = hits.filter((hit) => hit.citation.startsWith("test-replace#"));
    expect(fromDocument).toHaveLength(1);
    expect(fromDocument[0]?.text).toBe("the new wording");
  });

  it("keeps the same document id across a re-ingest", async () => {
    const first = await ingest(DEMO_TENANT_ID, "test-identity", [chunk(1, "one", axis(4))]);
    const second = await ingest(DEMO_TENANT_ID, "test-identity", [chunk(1, "two", axis(4))]);

    expect(second.id).toBe(first.id);
  });
});

describe("search", () => {
  beforeAll(async () => {
    await ingest(DEMO_TENANT_ID, "test-search", [
      chunk(1, "exactly on the query", axis(10)),
      chunk(2, "at forty-five degrees", between(10, 11)),
      chunk(3, "orthogonal to the query", axis(12)),
    ]);
  });

  it("orders by cosine distance, nearest first", async () => {
    // minScore 0 to see the orthogonal chunk too; other tests' documents are
    // filtered out here because at distance 1 their order against it is
    // arbitrary, and that is not what this asserts.
    const hits = await search(DEMO_TENANT_ID, {
      embedding: axis(10),
      limit: 20,
      minScore: 0,
    });

    const mine = hits
      .map((hit) => hit.citation)
      .filter((citation) => citation.startsWith("test-search#"));

    expect(mine).toEqual(["test-search#1", "test-search#2", "test-search#3"]);
  });

  it("returns a similarity, not a distance", async () => {
    // `<=>` is cosine *distance*, so the service flips it. Getting this
    // backwards would rank correctly and describe every result as terrible.
    const [exact, oblique] = await search(DEMO_TENANT_ID, {
      embedding: axis(10),
      limit: 2,
      minScore: 0,
    });

    expect(exact?.score).toBeCloseTo(1, 5);
    expect(oblique?.score).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it("returns nothing for a question the corpus does not cover", async () => {
    // The floor. Without it, nearest-neighbour search hands back the least
    // irrelevant passages with no sign that is what they are, and the model
    // answers from them — a confident wrong answer that needs no bug to occur.
    const hits = await search(DEMO_TENANT_ID, {
      embedding: axis(300),
      limit: 5,
    });

    expect(hits).toEqual([]);
  });

  it("keeps a weak but genuine match", async () => {
    // The floor is a noise threshold, not a relevance bar: 45° off is still
    // evidence, and discarding it would trade a wrong answer for no answer.
    const hits = await search(DEMO_TENANT_ID, {
      embedding: between(10, 11),
      limit: 5,
    });

    expect(hits.map((hit) => hit.citation)).toContain("test-search#2");
  });

  it("builds the citation from the row it returned", async () => {
    const [hit] = await search(DEMO_TENANT_ID, {
      embedding: axis(10),
      limit: 1,
    });

    expect(hit?.citation).toBe("test-search#1");
    expect(hit?.documentTitle).toBe("Title for test-search");
    expect(hit?.heading).toBe("Section 1");
  });

  it("honours the limit", async () => {
    const hits = await search(DEMO_TENANT_ID, {
      embedding: axis(10),
      limit: 2,
    });

    expect(hits).toHaveLength(2);
  });

  it("ignores chunks embedded by a different model", async () => {
    // The filter that is easy to leave out, and whose absence produces no
    // error: a vector from another embedder yields a perfectly ordinary
    // distance, so retrieval keeps working and starts being wrong.
    const hits = await search(DEMO_TENANT_ID, {
      embedding: axis(10),
      embeddingModel: "a-model-nothing-was-ingested-with",
      limit: 10,
    });

    expect(hits).toEqual([]);
  });
});

describe("tenant isolation", () => {
  it("does not return another clinic's passages", async () => {
    await ingest(SECOND_TENANT_ID, "test-riverside-only", [
      chunk(1, "Riverside's own policy", axis(20)),
    ]);

    const hits = await search(DEMO_TENANT_ID, {
      embedding: axis(20),
      limit: 10,
    });

    expect(hits.map((hit) => hit.citation)).not.toContain("test-riverside-only#1");
  });

  it("lets each clinic use the same slug for its own document", async () => {
    // Slugs are unique *per tenant*. A global unique index would mean one
    // clinic naming its opening-hours document stops another from having one.
    const northside = await ingest(DEMO_TENANT_ID, "test-shared-slug", [
      chunk(1, "Northside opens at eight", axis(30)),
    ]);
    const riverside = await ingest(SECOND_TENANT_ID, "test-shared-slug", [
      chunk(1, "Riverside opens at nine", axis(30)),
    ]);

    expect(riverside.id).not.toBe(northside.id);

    const hits = await search(SECOND_TENANT_ID, {
      embedding: axis(30),
      limit: 5,
    });

    expect(hits.map((hit) => hit.text)).toEqual(["Riverside opens at nine"]);
  });
});

describe("list", () => {
  it("summarises the corpus without returning its vectors", async () => {
    await ingest(DEMO_TENANT_ID, "test-listing", [
      chunk(1, "one", axis(40)),
      chunk(2, "two", axis(41)),
    ]);

    const actor = {
      userId: "00000000-0000-4000-8000-00000000dead",
      email: "test@demo.clinicpilot.io",
      tenantId: DEMO_TENANT_ID,
      role: "admin" as const,
    };

    const listed = await runWithActor(actor, () => documents.list());
    const found = listed.find((document) => document.slug === "test-listing");

    expect(found?.chunkCount).toBe(2);
    expect(found?.embeddingModel).toBe(MODEL);
    // 384 floats per chunk is a large response no screen has a use for.
    expect(found).not.toHaveProperty("embedding");
  });
});
