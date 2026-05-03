import assert from 'node:assert/strict';
import { test } from 'node:test';
import { customApiSecurityReviewService } from '../src/services/custom-api-security-review-service';

const baseInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    customerId: { type: 'string', maxLength: 64 },
  },
  required: ['customerId'],
};

const baseResponseMapping = {
  fields: {
    id: '$.id',
    name: '$.name',
  },
};

test('custom API base URL review blocks localhost and private IP hosts by default', () => {
  const localhost = customApiSecurityReviewService.validateBaseUrl('http://localhost:8080');
  assert.equal(localhost.valid, false);
  assert.match(localhost.errors.join(','), /https|blocked/);

  const privateIp = customApiSecurityReviewService.validateBaseUrl('https://127.0.0.1:8443');
  assert.equal(privateIp.valid, false);
  assert.match(privateIp.errors.join(','), /private IP/);
});

test('custom API endpoint review rejects secret headers and free-form schemas', () => {
  const result = customApiSecurityReviewService.validateEndpoint({
    method: 'GET',
    pathTemplate: '/customers/{customerId}',
    inputSchemaJson: {
      type: 'object',
      properties: {
        query: { type: 'object', additionalProperties: true, properties: { q: { type: 'string' } } },
      },
    },
    requestMappingJson: {
      staticHeaders: {
        Authorization: 'Bearer should-not-be-allowed',
      },
    },
    responseMappingJson: baseResponseMapping,
  });

  assert.equal(result.valid, false);
  const errors = result.errors.join(',');
  assert.match(errors, /additionalProperties/);
  assert.match(errors, /free-form object/);
  assert.match(errors, /Authorization is forbidden/);
});

test('custom API endpoint review requires confirmation for writes and high risk tools', () => {
  const writeWithoutConfirmation = customApiSecurityReviewService.validateEndpoint({
    method: 'POST',
    pathTemplate: '/customers',
    inputSchemaJson: baseInputSchema,
    responseMappingJson: baseResponseMapping,
  });

  assert.equal(writeWithoutConfirmation.valid, false);
  assert.match(writeWithoutConfirmation.errors.join(','), /write methods require confirmationPolicy/);

  const highRiskWithoutAdminTemplate = customApiSecurityReviewService.validateEndpoint({
    method: 'DELETE',
    pathTemplate: '/billing/refund/{customerId}',
    inputSchemaJson: baseInputSchema,
    responseMappingJson: baseResponseMapping,
    confirmationPolicy: 'require_user_confirmation',
  });

  assert.equal(highRiskWithoutAdminTemplate.valid, false);
  assert.match(highRiskWithoutAdminTemplate.errors.join(','), /high risk tools require admin approved confirmation template/);
});

test('custom API endpoint review normalizes safe read tools without leaking secrets', () => {
  const result = customApiSecurityReviewService.validateEndpoint({
    method: 'get',
    pathTemplate: '/customers/{customerId}',
    inputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      properties: {
        customerId: { type: 'string' },
      },
    },
    responseMappingJson: baseResponseMapping,
  });

  assert.equal(result.valid, true);
  assert.equal(result.normalized.method, 'GET');
  assert.deepEqual(result.normalized.inputSchemaJson, {
    type: 'object',
    additionalProperties: false,
    properties: {
      customerId: { type: 'string', maxLength: 2048 },
    },
  });
});
