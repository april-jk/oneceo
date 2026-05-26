import { describe, expect, it } from "vitest";
import {
  resolveHomeSubmitActiveSessionId,
  shouldAutoOpenManagedWorkspaceOnFirstSubmit,
} from "@/pages/Home";

describe("home managed workspace opening", () => {
  it("opens the workspace for the first managed submit from the input page", () => {
    expect(
      shouldAutoOpenManagedWorkspaceOnFirstSubmit({
        altusMode: "managed",
        pageMode: "input",
        activeSessionId: "",
      }),
    ).toBe(true);
  });

  it("does not reopen the workspace for managed continuation turns", () => {
    expect(
      shouldAutoOpenManagedWorkspaceOnFirstSubmit({
        altusMode: "managed",
        pageMode: "chat",
        activeSessionId: "session-1",
      }),
    ).toBe(false);
  });

  it("does not open the managed workspace for sandbox mode", () => {
    expect(
      shouldAutoOpenManagedWorkspaceOnFirstSubmit({
        altusMode: "sandbox",
        pageMode: "input",
        activeSessionId: "",
      }),
    ).toBe(false);
  });

  it("treats new-task new token as a fresh submit even if stale session state exists", () => {
    const activeSessionId = resolveHomeSubmitActiveSessionId({
      routeForcesNewSession: true,
      sessionId: "previous-session",
      uploadSessionId: "previous-upload-session",
    });

    expect(activeSessionId).toBe("");
    expect(
      shouldAutoOpenManagedWorkspaceOnFirstSubmit({
        altusMode: "managed",
        pageMode: "input",
        activeSessionId,
      }),
    ).toBe(true);
  });
});
