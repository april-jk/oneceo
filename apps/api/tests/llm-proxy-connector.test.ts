import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  sanitizeOpenAiChatCompletionProxyBody,
  toAnthropicRequest,
  toOpenAiChatCompletion,
  transformAnthropicStreamEvent,
} from '../src/connectors/llm-proxy-connector';

test('toAnthropicRequest maps OpenAI tools and tool results into Anthropic message blocks', () => {
  const payload = toAnthropicRequest({
    model: 'claude-sonnet-4-6',
    messages: [
      {
        role: 'system',
        content: 'You are Altus.',
      },
      {
        role: 'user',
        content: '帮我修改 index.html',
      },
      {
        role: 'assistant',
        content: '我将直接写入文件。',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({
                path: 'index.html',
                content: '<html></html>',
              }),
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: JSON.stringify({
          path: 'index.html',
          bytes: 13,
        }),
      },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'write_file',
          description: 'Write a UTF-8 file.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['path', 'content'],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: 'auto',
    max_tokens: 1024,
  });

  assert.equal(payload.system, 'You are Altus.');
  assert.deepEqual(payload.tools, [
    {
      name: 'write_file',
      description: 'Write a UTF-8 file.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
  ]);
  assert.deepEqual(payload.tool_choice, { type: 'auto' });
  assert.deepEqual(payload.messages, [
    {
      role: 'user',
      content: '帮我修改 index.html',
    },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: '我将直接写入文件。' },
        {
          type: 'tool_use',
          id: 'call_1',
          name: 'write_file',
          input: {
            path: 'index.html',
            content: '<html></html>',
          },
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_1',
          content: JSON.stringify({
            path: 'index.html',
            bytes: 13,
          }),
        },
      ],
    },
  ]);
});

test('sanitizeOpenAiChatCompletionProxyBody normalizes malformed OpenAI tool arguments before upstream passthrough', () => {
  const body = Buffer.from(
    JSON.stringify({
      model: 'code-model',
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'shell_execute',
                arguments: '{"command":"pnpm test"',
              },
            },
            {
              id: 'call-2',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: { path: 'package.json' },
              },
            },
          ],
        },
        {
          role: 'assistant',
          content: '',
          function_call: {
            name: 'legacy_tool',
            arguments: '[1,2,3]',
          },
        },
      ],
    }),
    'utf-8'
  );

  const sanitized = sanitizeOpenAiChatCompletionProxyBody('/v1/chat/completions', body);
  assert.ok(Buffer.isBuffer(sanitized));
  const payload = JSON.parse(sanitized.toString('utf-8'));

  assert.equal(payload.messages[0].tool_calls[0].function.arguments, '{}');
  assert.equal(payload.messages[0].tool_calls[1].function.arguments, '{"path":"package.json"}');
  assert.equal(payload.messages[1].function_call.arguments, '{}');
});

test('toAnthropicRequest normalizes malformed tool arguments through the shared sanitizer', () => {
  const payload = toAnthropicRequest({
    model: 'claude-sonnet-4-6',
    messages: [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call-shell-1',
            type: 'function',
            function: {
              name: 'shell_execute',
              arguments: '{"command":"pnpm test"',
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual(payload.messages, [
    {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'call-shell-1',
          name: 'shell_execute',
          input: {},
        },
      ],
    },
  ]);
});

test('toOpenAiChatCompletion maps Anthropic tool_use to OpenAI tool_calls', () => {
  const completion = toOpenAiChatCompletion({
    id: 'msg_1',
    model: 'claude-sonnet-4-6',
    stop_reason: 'tool_use',
    content: [
      { type: 'text', text: '我将写入文件。' },
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'write_file',
        input: {
          path: 'index.html',
          content: '<html></html>',
        },
      },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 20,
    },
  });

  assert.equal(completion.choices[0]?.finish_reason, 'tool_calls');
  assert.equal(completion.choices[0]?.message?.content, '我将写入文件。');
  assert.deepEqual(completion.choices[0]?.message?.tool_calls, [
    {
      id: 'toolu_1',
      type: 'function',
      function: {
        name: 'write_file',
        arguments: JSON.stringify({
          path: 'index.html',
          content: '<html></html>',
        }),
      },
    },
  ]);
});

test('toAnthropicRequest maps explicit tool_choice and marks tool_result errors', () => {
  const payload = toAnthropicRequest({
    model: 'claude-sonnet-4-6',
    messages: [
      {
        role: 'user',
        content: '修复启动脚本',
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_shell_1',
            type: 'function',
            function: {
              name: 'shell_execute',
              arguments: JSON.stringify({
                command: 'pnpm check',
              }),
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_shell_1',
        content: JSON.stringify({
          error: 'command failed',
        }),
      },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'shell_execute',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' },
            },
            required: ['command'],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: {
      type: 'function',
      function: {
        name: 'shell_execute',
      },
    },
  });

  assert.deepEqual(payload.tool_choice, {
    type: 'tool',
    name: 'shell_execute',
  });
  assert.deepEqual(payload.messages, [
    {
      role: 'user',
      content: '修复启动脚本',
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'call_shell_1',
          name: 'shell_execute',
          input: {
            command: 'pnpm check',
          },
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_shell_1',
          content: JSON.stringify({
            error: 'command failed',
          }),
          is_error: true,
        },
      ],
    },
  ]);
});

test('toAnthropicRequest preserves multimodal user images as anthropic image blocks', () => {
  const payload = toAnthropicRequest({
    model: 'claude-sonnet-4-6',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '看看这个图讲了什么',
          },
          {
            type: 'image_url',
            image_url: {
              url: 'https://images.example.com/managed-images/session-1/msg-1/screenshot.png?token=abc',
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual(payload.messages, [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: '看看这个图讲了什么',
        },
        {
          type: 'image',
          source: {
            type: 'url',
            url: 'https://images.example.com/managed-images/session-1/msg-1/screenshot.png?token=abc',
          },
        },
      ],
    },
  ]);
});

test('transformAnthropicStreamEvent maps text and tool streaming events to OpenAI chunks', () => {
  const state = {
    id: 'chatcmpl_stream_1',
    model: 'claude-sonnet-4-6',
    created: 1710000000,
    roleSent: false,
    toolIndexes: new Map<number, number>(),
  };

  const startChunks = transformAnthropicStreamEvent(
    {
      event: 'message_start',
      data: {
        message: {
          id: 'msg_stream_1',
          model: 'claude-sonnet-4-6',
        },
      },
    },
    state
  );
  assert.equal(startChunks.length, 1);
  assert.match(startChunks[0]!, /"role":"assistant"/);

  const textChunks = transformAnthropicStreamEvent(
    {
      event: 'content_block_delta',
      data: {
        index: 0,
        delta: {
          type: 'text_delta',
          text: '正在生成文件',
        },
      },
    },
    state
  );
  assert.equal(textChunks.length, 1);
  assert.match(textChunks[0]!, /"content":"正在生成文件"/);

  const toolStartChunks = transformAnthropicStreamEvent(
    {
      event: 'content_block_start',
      data: {
        index: 1,
        content_block: {
          type: 'tool_use',
          id: 'toolu_stream_1',
          name: 'write_file',
        },
      },
    },
    state
  );
  assert.equal(toolStartChunks.length, 1);
  assert.match(toolStartChunks[0]!, /"tool_calls"/);
  assert.match(toolStartChunks[0]!, /"name":"write_file"/);

  const toolArgChunks = transformAnthropicStreamEvent(
    {
      event: 'content_block_delta',
      data: {
        index: 1,
        delta: {
          type: 'input_json_delta',
          partial_json: '{"path":"index.html"}',
        },
      },
    },
    state
  );
  assert.equal(toolArgChunks.length, 1);
  assert.match(toolArgChunks[0]!, /\\"path\\":\\"index\.html\\"/);

  const finishChunks = transformAnthropicStreamEvent(
    {
      event: 'message_delta',
      data: {
        delta: {
          stop_reason: 'tool_use',
        },
      },
    },
    state
  );
  assert.equal(finishChunks.length, 1);
  assert.match(finishChunks[0]!, /"finish_reason":"tool_calls"/);

  const doneChunks = transformAnthropicStreamEvent(
    {
      event: 'message_stop',
      data: {},
    },
    state
  );
  assert.deepEqual(doneChunks, ['data: [DONE]\n\n']);
});

test('transformAnthropicStreamEvent maps error events to OpenAI error payload', () => {
  const state = {
    id: 'chatcmpl_stream_2',
    model: 'claude-sonnet-4-6',
    created: 1710000001,
    roleSent: true,
    toolIndexes: new Map<number, number>(),
  };

  const errorChunks = transformAnthropicStreamEvent(
    {
      event: 'error',
      data: {
        error: {
          message: 'upstream exploded',
          type: 'api_error',
          code: 'api_error',
        },
      },
    },
    state
  );

  assert.equal(errorChunks.length, 2);
  assert.match(errorChunks[0]!, /"error"/);
  assert.match(errorChunks[0]!, /"upstream exploded"/);
  assert.equal(errorChunks[1], 'data: [DONE]\n\n');
});
