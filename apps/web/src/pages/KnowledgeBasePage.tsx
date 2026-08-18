import { useMemo, useState } from "react";
import { BookText, Library, Search } from "lucide-react";

import { Card, EmptyState, KpiTile, RefreshControl, Skeleton } from "@/components/primitives";
import { listDocuments } from "@/lib/api";
import { useApi } from "@/lib/useApi";

/**
 * What the Document Q&A agent can answer from.
 *
 * `GET /api/documents` has shipped since Phase 3 and nothing rendered it, so
 * the only way to answer "what does this agent actually know" was to read the
 * seed script. That is a bad answer for a product whose whole claim is that
 * the agent cites its sources.
 *
 * The unit on screen is the **passage**, not the document. Retrieval searches
 * chunks and a citation points at one, so a document with no passages is
 * invisible to the agent no matter how good its contents are — which is why
 * that case gets called out rather than rendered as a quiet zero.
 *
 * This list is RLS-scoped like every other read, and the seeded corpus is
 * chosen so that shows: both clinics share five policies and each has its own
 * opening hours. Switching tenant changes what is on this page.
 */
export function KnowledgeBasePage() {
  // Slower than the inbox: a corpus changes when somebody runs an ingest, not
  // while you are looking at it.
  const { data, error, loading, updatedAt, reload } = useApi(listDocuments, [], {
    pollMs: 60_000,
  });
  const [query, setQuery] = useState("");

  // Memoised, not `data ?? []` inline: a fresh array every render would make
  // the filter below recompute on every keystroke elsewhere on the page.
  const documents = useMemo(() => data ?? [], [data]);

  const passages = documents.reduce((total, doc) => total + doc.chunkCount, 0);
  const unembedded = documents.filter((doc) => doc.chunkCount === 0).length;

  // Every chunk of a document is embedded by one embedder in one transaction,
  // so a corpus with two models in it means a half-finished re-ingest — worth
  // showing rather than collapsing to whichever one sorted first.
  const embedders = [
    ...new Set(documents.map((doc) => doc.embeddingModel).filter((m): m is string => Boolean(m))),
  ];

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return documents;
    return documents.filter(
      (doc) =>
        doc.title.toLowerCase().includes(needle) ||
        doc.slug.toLowerCase().includes(needle) ||
        (doc.source ?? "").toLowerCase().includes(needle),
    );
  }, [documents, query]);

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Knowledge Base</h1>
          <p className="text-sm text-muted">
            The corpus the Document Q&amp;A agent answers from. It cites a passage from here or it
            does not answer.
          </p>
        </div>
        <RefreshControl updatedAt={updatedAt} busy={loading} onRefresh={reload} />
      </div>

      {error && (
        <Card className="border-danger/40 p-4 text-sm text-danger">
          Could not reach the API: {error}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTile
          label="Documents"
          value={String(documents.length)}
          hint={
            unembedded
              ? `${unembedded} with no passages — not retrievable`
              : "All ingested for this clinic"
          }
        />
        <KpiTile
          label="Passages"
          value={passages.toLocaleString()}
          hint="Retrieval searches these, and a citation points at one"
        />
        <KpiTile
          label="Embedding"
          value={embedders.length === 1 ? embedders[0]! : embedders.length ? "Mixed" : "—"}
          hint={
            embedders.length > 1
              ? `${embedders.length} models in one corpus — re-ingest did not finish`
              : "Lexical, not semantic — see ADR-009"
          }
        />
      </div>

      <Card className="flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search documents by title, slug or source"
            placeholder="Search titles and sources…"
            className="w-full rounded-md border border-border bg-surface-2 py-1.5 pl-8 pr-3 text-sm placeholder:text-muted focus:border-border-strong"
          />
        </div>
        <span className="ml-auto font-mono text-xs text-muted tnum">
          {shown.length} of {documents.length}
        </span>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">
              Documents ingested into this clinic&rsquo;s corpus, with the number of passages each
              was split into and the embedder that indexed them.
            </caption>
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="px-4 py-3 font-medium">
                  Document
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Source
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Passages
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Embedding
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Updated
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((doc) => (
                <tr key={doc.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{doc.title}</div>
                    {/* The slug is the key the gateway replaces on, so a
                        re-ingest that changes it silently creates a second
                        document rather than updating the first. */}
                    <div className="font-mono text-xs text-muted">{doc.slug}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{doc.source ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs tnum">
                    {doc.chunkCount === 0 ? (
                      <span className="text-danger">0 · not retrievable</span>
                    ) : (
                      doc.chunkCount
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">
                    {doc.embeddingModel ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted tnum">
                    {new Date(doc.updatedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {loading && !data && (
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-6" />
            ))}
          </div>
        )}
      </Card>

      {!loading && shown.length === 0 && !error && (
        <EmptyState
          icon={query.trim() ? Search : BookText}
          title={query.trim() ? "No document matches that" : "This clinic has no documents yet"}
        >
          {query.trim() ? (
            "Clear the search — it matches on title, slug and source file."
          ) : (
            <>
              The Document Q&amp;A agent has nothing to cite, so it will escalate every question.
              Ingest the seeded corpus with{" "}
              <code className="rounded bg-surface-2 px-1 py-0.5 font-mono">
                python -m app.rag.ingest --demo
              </code>
              .
            </>
          )}
        </EmptyState>
      )}

      {/*
        Naming the embedder's limit on the screen that lists the corpus, rather
        than only in an ADR nobody reading this page has open. It matches on
        words, so a patient asking about "meds" will not reach a passage that
        only ever says "prescriptions" — the fix is a real embedding model
        behind the same interface, not a bigger corpus.
      */}
      <p className="flex items-start gap-2 text-xs text-muted">
        <Library className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Passages are matched <strong className="font-medium text-text">lexically</strong> —
          hashed word overlap, not meaning. A question phrased with different words to the document
          may miss. ADR-009 records why, and what it costs.
        </span>
      </p>
    </div>
  );
}
