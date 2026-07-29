import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

/**
 * Validates a request body against a zod schema from `@clinicpilot/shared-types`.
 *
 * Deliberately not class-validator, which is the Nest default: the wire
 * contracts already exist as zod schemas shared with the web app, and having
 * one set of decorators for the server and one set of schemas for the client
 * is how the two drift apart.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException({
        message: "Request body failed validation",
        // Field-level detail, because "Bad Request" alone tells the caller
        // nothing about which field they got wrong.
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join(".") || "(root)",
          message: issue.message,
        })),
      });
    }

    return result.data;
  }
}
