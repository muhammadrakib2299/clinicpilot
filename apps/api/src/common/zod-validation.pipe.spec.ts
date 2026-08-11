import { BadRequestException, type ArgumentMetadata } from "@nestjs/common";
import { CreateTaskInput, FindFreeSlotsQuery } from "@clinicpilot/shared-types";

import { ZodValidationPipe } from "./zod-validation.pipe";

const meta = (type: ArgumentMetadata["type"]): ArgumentMetadata => ({ type, metatype: undefined });

const issuesOf = (error: unknown) =>
  (error as BadRequestException).getResponse() as {
    message: string;
    issues: Array<{ path: string; message: string }>;
  };

describe("ZodValidationPipe", () => {
  it("returns the parsed value, with defaults applied", () => {
    const pipe = new ZodValidationPipe(CreateTaskInput);

    const parsed = pipe.transform({ agentKind: "scheduling", input: "move my appointment" });

    expect(parsed.channel).toBe("web");
  });

  it("reports which field failed, not just that something did", () => {
    const pipe = new ZodValidationPipe(CreateTaskInput);

    try {
      pipe.transform({ agentKind: "scheduling", input: "" }, meta("body"));
      throw new Error("expected the pipe to reject an empty task input");
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect(issuesOf(error).issues).toEqual([
        { path: "input", message: "a task needs something to act on" },
      ]);
    }
  });

  it("names the query string when a query parameter is what failed", () => {
    // The `internal/` caller is a tool executor handing this message to a
    // model; saying "body" sends it looking in the wrong place.
    const pipe = new ZodValidationPipe(FindFreeSlotsQuery);

    try {
      pipe.transform({ scheduleId: "1", from: "next Tuesday" }, meta("query"));
      throw new Error("expected the pipe to reject a malformed instant");
    } catch (error) {
      expect(issuesOf(error).message).toBe("Request query failed validation");
      expect(issuesOf(error).issues[0]?.path).toBe("from");
    }
  });

  it("falls back to a neutral word when Nest passes no metadata", () => {
    const pipe = new ZodValidationPipe(CreateTaskInput);

    try {
      pipe.transform({});
      throw new Error("expected the pipe to reject an empty body");
    } catch (error) {
      expect(issuesOf(error).message).toBe("Request input failed validation");
    }
  });

  it("labels a root-level failure rather than emitting an empty path", () => {
    const pipe = new ZodValidationPipe(CreateTaskInput);

    try {
      pipe.transform("not an object", meta("body"));
      throw new Error("expected the pipe to reject a non-object body");
    } catch (error) {
      expect(issuesOf(error).issues[0]?.path).toBe("(root)");
    }
  });
});
