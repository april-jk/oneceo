import { expect, test } from "@playwright/test";
import { shouldExpandManagedWriteFileCard } from "../pages/Home";

test("expands write_file card while running with progress payload", async () => {
  const expanded = shouldExpandManagedWriteFileCard({
    toolName: "write_file",
    status: "running",
    metadata: {
      writeFileProgress: {
        path: "snake-game/index.html",
        generatedChars: 4308,
        preview: "<html><body>snake game</body></html>",
      },
    },
  });

  expect(expanded).toBeTruthy();
});

test("collapses write_file card after completion", async () => {
  const expanded = shouldExpandManagedWriteFileCard({
    toolName: "write_file",
    status: "completed",
    metadata: {
      writeFileProgress: {
        path: "snake-game/index.html",
        generatedChars: 4308,
        preview: "<html><body>snake game</body></html>",
      },
    },
  });

  expect(expanded).toBeFalsy();
});

test("keeps non-write_file tools compact", async () => {
  const expanded = shouldExpandManagedWriteFileCard({
    toolName: "shell_execute",
    status: "running",
    metadata: {
      writeFileProgress: {
        generatedChars: 9999,
        preview: "echo hello",
      },
    },
  });

  expect(expanded).toBeFalsy();
});

