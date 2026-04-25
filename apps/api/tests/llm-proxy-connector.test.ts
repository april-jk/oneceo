import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
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

  assert.deepEqual(payload.system, [{ type: 'text', text: 'You are Altus.', cache_control: { type: 'ephemeral' } }]);
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

test('toOpenAiChatCompletion normalizes cached token usage fields', () => {
  const completion = toOpenAiChatCompletion({
    id: 'msg_cache_1',
    model: 'qwen3-max-2026-01-23',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'ok' }],
    usage: {
      input_tokens: 1000,
      output_tokens: 100,
      prompt_tokens_details: {
        cached_tokens: 240,
        cache_creation_input_tokens: 80,
      },
    },
  });

  assert.equal(completion.usage.prompt_tokens, 1000);
  assert.equal(completion.usage.completion_tokens, 100);
  assert.equal(completion.usage.prompt_tokens_details?.cached_tokens, 240);
  assert.equal(completion.usage.prompt_tokens_details?.cache_creation_input_tokens, 80);
  assert.equal(completion.usage.cache_creation_input_tokens, 80);
});

test('toOpenAiChatCompletion accepts DashScope cached_tokens compatibility field', () => {
  const completion = toOpenAiChatCompletion({
    id: 'msg_cache_2',
    model: 'qwen3-max-2026-01-23',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'ok' }],
    usage: {
      input_tokens: 1000,
      output_tokens: 100,
      cached_tokens: 320,
    },
  });

  assert.equal(completion.usage.prompt_tokens_details?.cached_tokens, 320);
});

test('toOpenAiChatCompletion reads DashScope nested cache creation details', () => {
  const completion = toOpenAiChatCompletion({
    id: 'msg_cache_3',
    model: 'qwen3-max-2026-01-23',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'ok' }],
    usage: {
      input_tokens: 1600,
      output_tokens: 100,
      prompt_tokens_details: {
        cached_tokens: 0,
        cache_creation: {
          cache_type: 'ephemeral',
          ephemeral_5m_input_tokens: 1536,
          cache_creation_input_tokens: 1536,
        },
      },
    },
  });

  assert.equal(completion.usage.prompt_tokens_details?.cache_creation_input_tokens, 1536);
  assert.equal(completion.usage.cache_creation_input_tokens, 1536);
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

test('transformAnthropicStreamEvent normalizes cache usage in stream chunks', () => {
  const state = {
    id: 'chatcmpl_stream_cache',
    model: 'qwen3-max-2026-01-23',
    created: 1710000002,
    roleSent: true,
    toolIndexes: new Map<number, number>(),
  };

  const chunks = transformAnthropicStreamEvent(
    {
      event: 'message_delta',
      data: {
        delta: {
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 1000,
            output_tokens: 100,
            prompt_tokens_details: {
              cached_tokens: 200,
              cache_creation_input_tokens: 50,
            },
          },
        },
      },
    },
    state
  );

  assert.equal(chunks.length, 1);
  const payload = JSON.parse(chunks[0]!.replace(/^data: /, '').trim());
  assert.equal(payload.usage.prompt_tokens_details.cached_tokens, 200);
  assert.equal(payload.usage.prompt_tokens_details.cache_creation_input_tokens, 50);
  assert.equal(payload.usage.cache_creation_input_tokens, 50);
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
