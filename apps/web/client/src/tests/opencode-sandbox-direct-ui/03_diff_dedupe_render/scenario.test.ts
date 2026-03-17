import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '@/hooks/useTaskCreationAgent';
import { buildChatItems } from '@/pages/Home';
import { buildPreviewItems } from '@/lib/opencode-preview';

function sessionDiffEvent(): AgentMessage {
  const diffPayload = [
    {
      file: 'node_modules/example/index.js',
      before: '',
      after: 'module.exports = 1;',
      additions: 1,
      deletions: 0,
      status: 'added',
    },
  ];

  return {
    type: 'opencode_event',
    content: '',
    metadata: {
      eventType: 'session.diff',
      event: {
        type: 'session.diff',
        properties: {
          diff: diffPayload,
        },
      },
      rawPayload: {
        event: {
          type: 'session.diff',
          properties: {
            diff: diffPayload,
          },
        },
      },
    },
  };
}

function applyPatchEvent(path = 'src/index.ts'): AgentMessage {
  const patch = [
    '*** Begin Patch',
    `*** Update File: ${path}`,
    '@@',
    '-console.log("before")',
    '+console.log("after")',
    '*** End Patch',
  ].join('\n');

  return {
    type: 'opencode_event',
    content: '',
    metadata: {
      eventType: 'message.part.updated',
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'tool',
            tool: 'apply_patch',
            state: {
              input: patch,
            },
          },
        },
      },
      rawPayload: {
        event: {
          type: 'message.part.updated',
          properties: {
            part: {
              type: 'tool',
              tool: 'apply_patch',
              state: {
                input: patch,
              },
            },
          },
        },
      },
    },
  };
}

function writeEvent(path: string): AgentMessage {
  return {
    type: 'opencode_event',
    content: 'write',
    metadata: {
      eventType: 'message.part.updated',
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'tool',
            id: 'prt_write_001',
            tool: 'write',
            state: {
              status: 'completed',
              input: {
                filePath: path,
                content: 'console.log("hello");\n',
              },
            },
          },
        },
      },
      rawPayload: {
        event: {
          type: 'message.part.updated',
          properties: {
            part: {
              type: 'tool',
              id: 'prt_write_001',
              tool: 'write',
              state: {
                status: 'completed',
                input: {
                  filePath: path,
                  content: 'console.log("hello");\n',
                },
              },
            },
          },
        },
      },
    },
  };
}

function sessionDiffForFile(path: string): AgentMessage {
  const diffPayload = [
    {
      file: path,
      before: '',
      after: 'console.log("hello");\n',
      additions: 1,
      deletions: 0,
      status: 'added',
    },
  ];

  return {
    type: 'opencode_event',
    content: '',
    metadata: {
      eventType: 'session.diff',
      event: {
        type: 'session.diff',
        properties: {
          diff: diffPayload,
        },
      },
      rawPayload: {
        event: {
          type: 'session.diff',
          properties: {
            diff: diffPayload,
          },
        },
      },
    },
  };
}

function bashEvent(command = 'npm install'): AgentMessage {
  return {
    type: 'opencode_event',
    content: 'bash',
    metadata: {
      eventType: 'message.part.updated',
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'tool',
            id: 'prt_bash_001',
            tool: 'bash',
            state: {
              status: 'completed',
              input: {
                command,
              },
            },
          },
        },
      },
      rawPayload: {
        event: {
          type: 'message.part.updated',
          properties: {
            part: {
              type: 'tool',
              id: 'prt_bash_001',
              tool: 'bash',
              state: {
                status: 'completed',
                input: {
                  command,
                },
              },
            },
          },
        },
      },
    },
  };
}

describe('03_diff_dedupe_render', () => {
  it('ignores session.diff and keeps one diff card for duplicated apply_patch payload', () => {
    const messages: AgentMessage[] = [sessionDiffEvent(), applyPatchEvent(), applyPatchEvent()];
    const items = buildChatItems(messages);
    const diffCards = items.flatMap((item) => {
      if (item.kind === 'opencode_tool') {
        return [item];
      }
      if (item.kind === 'opencode_turn') {
        return item.assistantParts
          .filter((part) => part.kind === 'tool')
          .map((part) => ({
            kind: 'opencode_tool' as const,
            eventType: part.eventType,
          }));
      }
      return [];
    });

    expect(diffCards).toHaveLength(1);
    expect(diffCards[0].eventType).toBe('message.part.updated');
  });

  it('keeps apply_patch diff under node_modules path', () => {
    const messages: AgentMessage[] = [applyPatchEvent('node_modules/pkg/index.js')];
    const { diffItems } = buildPreviewItems(messages);

    expect(diffItems.length).toBeGreaterThan(0);
    expect(
      diffItems.some((item) => (item.diff || '').includes('*** Update File: node_modules/pkg/index.js'))
    ).toBe(true);
  });

  it('keeps apply_patch diff under python venv path', () => {
    const messages: AgentMessage[] = [applyPatchEvent('.venv/lib/python3.11/site-packages/demo/core.py')];
    const { diffItems } = buildPreviewItems(messages);

    expect(diffItems.length).toBeGreaterThan(0);
    expect(
      diffItems.some((item) =>
        (item.diff || '').includes('*** Update File: .venv/lib/python3.11/site-packages/demo/core.py')
      )
    ).toBe(true);
  });

  it('keeps correlated session.diff from write tool and links to write message index', () => {
    const path = 'src/generated/report.ts';
    const messages: AgentMessage[] = [writeEvent(path), sessionDiffForFile(path)];
    const { diffItems } = buildPreviewItems(messages);

    expect(diffItems).toHaveLength(1);
    expect(diffItems[0].source).toBe('write');
    expect(diffItems[0].files?.[0]?.file).toBe(path);
    expect(diffItems[0].relatedEventIndexes).toContain(0);
  });

  it('ignores uncorrelated session.diff (e.g. shell installs)', () => {
    const messages: AgentMessage[] = [bashEvent(), sessionDiffForFile('node_modules/pkg/index.js')];
    const { diffItems } = buildPreviewItems(messages);

    expect(diffItems).toHaveLength(0);
  });

  it('keeps session.diff text when write tool is inferred from content only', () => {
    const messages: AgentMessage[] = [
      {
        type: 'opencode_event',
        content: '[Tool] write',
        metadata: {
          eventType: 'message.part.updated',
        },
      },
      {
        type: 'opencode_event',
        content: '',
        metadata: {
          eventType: 'session.diff',
          event: {
            type: 'session.diff',
            properties: {
              diff: 'opaque diff payload',
            },
          },
          rawPayload: {
            event: {
              type: 'session.diff',
              properties: {
                diff: 'opaque diff payload',
              },
            },
          },
        },
      },
    ];

    const { diffItems } = buildPreviewItems(messages);
    expect(diffItems).toHaveLength(1);
    expect(diffItems[0].source).toBe('session.diff');
    expect(diffItems[0].relatedEventIndexes).toContain(0);
    expect(diffItems[0].relatedEventIndexes).toContain(1);
  });

  it('parses JSON-string metadata and renders write diff', () => {
    const metaObject = {
      eventType: 'message.part.updated',
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'tool',
            tool: 'write',
            state: {
              status: 'completed',
              input: {
                filePath: 'src/json-meta.ts',
                content: 'export const v = 1;\n',
              },
            },
          },
        },
      },
      rawPayload: {
        event: {
          type: 'message.part.updated',
          properties: {
            part: {
              type: 'tool',
              tool: 'write',
              state: {
                status: 'completed',
                input: {
                  filePath: 'src/json-meta.ts',
                  content: 'export const v = 1;\n',
                },
              },
            },
          },
        },
      },
    };
    const messages: AgentMessage[] = [
      {
        type: 'opencode_event',
        content: '[Tool] write',
        metadata: JSON.stringify(metaObject),
      },
    ];

    const { diffItems } = buildPreviewItems(messages);
    expect(diffItems).toHaveLength(1);
    expect(diffItems[0].source).toBe('write');
    expect(diffItems[0].files?.[0]?.file).toBe('src/json-meta.ts');
  });
});
