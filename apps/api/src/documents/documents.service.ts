import { Injectable } from "@nestjs/common";
import type {
  DocumentSummary,
  IngestDocumentInput,
  RetrievedChunk,
  SearchDocumentsInput,
} from "@clinicpilot/shared-types";
import { and, cosineDistance, desc, eq, sql } from "drizzle-orm";

import { AuditService } from "../audit/audit.service";
import { currentTenantId } from "../common/tenant";
import { DbService } from "../db/db.service";
import { documentChunks, documents } from "../db/schema";

/**
 * The corpus the Document Q&A agent answers from.
 *
 * The gateway stores and searches; the AI service chunks and embeds. That
 * split exists because a vector is only comparable to vectors produced by the
 * *same* code, and reimplementing an embedder in TypeScript so the gateway
 * could do ingest itself is the arrangement that produced a malformed
 * `Slot/Slot/…` reference in Phase 1 — two implementations of one rule.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly dbService: DbService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Store one document and its passages, replacing any earlier version.
   *
   * Replace rather than append: re-running ingest after an edit must not leave
   * the previous passages in the index, where they would rank against the new
   * ones and let the agent cite text nobody can find in the document any more.
   *
   * All of it in one transaction, so a failure part-way through cannot leave a
   * document with the old chunks deleted and the new ones missing — which
   * would read to the agent as "this document says nothing".
   */
  async ingest(tenantId: string, input: IngestDocumentInput): Promise<DocumentSummary> {
    const summary = await this.dbService.withTenant(tenantId, async (tx) => {
      const [document] = await tx
        .insert(documents)
        .values({
          tenantId,
          slug: input.slug,
          title: input.title,
          source: input.source ?? null,
        })
        .onConflictDoUpdate({
          target: [documents.tenantId, documents.slug],
          set: { title: input.title, source: input.source ?? null, updatedAt: new Date() },
        })
        .returning();

      await tx.delete(documentChunks).where(eq(documentChunks.documentId, document!.id));

      await tx.insert(documentChunks).values(
        input.chunks.map((chunk) => ({
          tenantId,
          documentId: document!.id,
          ordinal: chunk.ordinal,
          heading: chunk.heading ?? null,
          text: chunk.text,
          embedding: chunk.embedding,
          embeddingModel: input.embeddingModel,
        })),
      );

      return {
        id: document!.id,
        slug: document!.slug,
        title: document!.title,
        source: document!.source,
        chunkCount: input.chunks.length,
        embeddingModel: input.embeddingModel,
        updatedAt: document!.updatedAt.toISOString(),
      };
    });

    await this.audit.recordSystem({
      tenantId,
      action: "document.ingested",
      resourceType: "document",
      resourceId: summary.id,
      metadata: {
        slug: summary.slug,
        chunkCount: summary.chunkCount,
        embeddingModel: input.embeddingModel,
      },
    });

    return summary;
  }

  /**
   * Nearest passages to a query vector, within one tenant.
   *
   * Three filters, and only the first is obvious. `tenantId` is belt-and-braces
   * over RLS. `embeddingModel` stops vectors from a different embedder being
   * compared, because that comparison yields an ordinary-looking distance
   * rather than an error. `minScore` is the one this codebase learned the hard
   * way: nearest-neighbour search always returns neighbours, so a question the
   * corpus does not cover came back with the least irrelevant passages in it
   * and no indication that is what they were.
   *
   * Ordered by distance ascending — `<=>` is cosine *distance*, so smaller is
   * closer, and the score handed back is `1 - distance` because "0.91" reads
   * as a better match than "0.09" to everyone including the model.
   */
  async search(tenantId: string, input: SearchDocumentsInput): Promise<RetrievedChunk[]> {
    const distance = cosineDistance(documentChunks.embedding, input.embedding);

    const rows = await this.dbService.withTenant(tenantId, (tx) =>
      tx
        .select({
          slug: documents.slug,
          title: documents.title,
          ordinal: documentChunks.ordinal,
          heading: documentChunks.heading,
          text: documentChunks.text,
          score: sql<number>`1 - (${distance})`.as("score"),
        })
        .from(documentChunks)
        .innerJoin(documents, eq(documents.id, documentChunks.documentId))
        .where(
          and(
            eq(documentChunks.tenantId, tenantId),
            eq(documentChunks.embeddingModel, input.embeddingModel),
            // Repeated rather than referencing the `score` alias: Postgres does
            // not allow a select alias in WHERE, and pushing it into HAVING or
            // a subquery to save one distance computation would trade clarity
            // for an index scan this table does not have anyway.
            sql`1 - (${distance}) >= ${input.minScore}`,
          ),
        )
        .orderBy(distance)
        .limit(input.limit),
    );

    return rows.map((row) => ({
      // Assembled here, never accepted from a caller. Every citation that
      // exists therefore corresponds to a row that was actually returned,
      // which is what lets an answer's citations be checked at all.
      citation: `${row.slug}#${row.ordinal}`,
      documentTitle: row.title,
      heading: row.heading,
      text: row.text,
      score: Number(row.score),
    }));
  }

  /**
   * The corpus, for the clinic to see what its agent can answer from.
   *
   * Not role-gated, for the same reason `messages` is not: within a tenant
   * these are the practice's own policies and opening hours, and RLS is what
   * keeps them inside it. Vectors are deliberately not returned — 384 floats
   * per chunk is a large response that no screen has a use for.
   */
  async list(): Promise<DocumentSummary[]> {
    const tenantId = currentTenantId();

    const rows = await this.dbService.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: documents.id,
          slug: documents.slug,
          title: documents.title,
          source: documents.source,
          updatedAt: documents.updatedAt,
          chunkCount: sql<number>`count(${documentChunks.id})`.as("chunk_count"),
          // Every chunk of a document is ingested by one embedder in one
          // transaction, so max() is that model, not an arbitrary pick.
          embeddingModel: sql<string | null>`max(${documentChunks.embeddingModel})`.as(
            "embedding_model",
          ),
        })
        .from(documents)
        .leftJoin(documentChunks, eq(documentChunks.documentId, documents.id))
        .where(eq(documents.tenantId, tenantId))
        .groupBy(documents.id)
        .orderBy(desc(documents.updatedAt)),
    );

    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      source: row.source,
      chunkCount: Number(row.chunkCount),
      embeddingModel: row.embeddingModel,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }
}
