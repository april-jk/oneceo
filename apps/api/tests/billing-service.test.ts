import assert from 'node:assert/strict';
import { test, describe, beforeEach, afterEach } from 'node:test';
import { pricingService } from '../src/services/pricing-service';
import { billingService } from '../src/services/billing-service';
import { db } from '../src/config/database';

// Mock db for billing service tests
const mockDb = {
  select: () => mockDb,
  from: () => mockDb,
  where: () => mockDb,
  limit: () => mockDb,
  offset: () => mockDb,
  orderBy: () => mockDb,
  innerJoin: () => mockDb,
  insert: () => mockDb,
  values: () => mockDb,
  returning: () => Promise.resolve([]),
  update: () => mockDb,
  set: () => mockDb,
  transaction: async (fn: any) => fn(mockDb),
  groupBy: () => mockDb,
};

describe('PricingService.calculateCredits', () => {
  test('calculates basic OpenAI pricing without cache', () => {
    const pricing = {
      id: '1',
      model: 'gpt-4o',
      modelProvider: 'openai',
      promptPricePer1kTokens: 100, // 100 credits per 1k tokens
      completionPricePer1kTokens: 200,
      isActive: true,
      effectiveFrom: new Date(),
      effectiveUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const credits = pricingService.calculateCredits({
      promptTokens: 1000,
      completionTokens: 500,
    }, pricing as any);

    // (1000 * 100 / 1000) + (500 * 200 / 1000) = 100 + 100 = 200
    assert.strictEqual(credits, 200);
  });

  test('calculates OpenAI pricing with cache hit', () => {
    const pricing = {
      id: '1',
      model: 'gpt-4o',
      modelProvider: 'openai',
      promptPricePer1kTokens: 100,
      completionPricePer1kTokens: 200,
      isActive: true,
      effectiveFrom: new Date(),
      effectiveUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const credits = pricingService.calculateCredits({
      promptTokens: 1000,
      cachedPromptTokens: 800,
      nonCachedPromptTokens: 200,
      completionTokens: 500,
    }, pricing as any);

    // (200 * 100 / 1000) + (800 * 50 / 1000) + (500 * 200 / 1000)
    // = 20 + 40 + 100 = 160
    assert.strictEqual(credits, 160);
  });

  test('calculates Anthropic pricing with cache hit and creation', () => {
    const pricing = {
      id: '1',
      model: 'claude-sonnet-4-6',
      modelProvider: 'anthropic',
      promptPricePer1kTokens: 100,
      completionPricePer1kTokens: 200,
      isActive: true,
      effectiveFrom: new Date(),
      effectiveUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const credits = pricingService.calculateCredits({
      promptTokens: 1000,
      cachedPromptTokens: 500,
      nonCachedPromptTokens: 400,
      cacheCreationTokens: 100,
      completionTokens: 500,
    }, pricing as any);

    // (400 * 100 / 1000) + (500 * 10 / 1000) + (100 * 125 / 1000) + (500 * 200 / 1000)
    // = 40 + 5 + 12.5 + 100 = 157.5 -> ceil = 158
    assert.strictEqual(credits, 158);
  });

  test('returns correct default cache ratios via getDefaultCacheRatios', () => {
    const openaiRatios = pricingService.getDefaultCacheRatios('openai');
    assert.deepStrictEqual(openaiRatios, { hit: 0.5, creation: 0 });

    const anthropicRatios = pricingService.getDefaultCacheRatios('anthropic');
    assert.deepStrictEqual(anthropicRatios, { hit: 0.1, creation: 1.25 });

    const unknownRatios = pricingService.getDefaultCacheRatios('unknown');
    assert.strictEqual(unknownRatios, null);
  });

  test('calculateCredits accepts explicit cacheRatio override', () => {
    const pricing = {
      id: '1',
      model: 'gpt-4o',
      modelProvider: 'openai',
      promptPricePer1kTokens: 100,
      completionPricePer1kTokens: 200,
      isActive: true,
      effectiveFrom: new Date(),
      effectiveUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // 使用自定义缓存比例 30% 命中
    const credits = pricingService.calculateCredits({
      promptTokens: 1000,
      cachedPromptTokens: 800,
      nonCachedPromptTokens: 200,
      completionTokens: 500,
    }, pricing as any, { hit: 0.3, creation: 0 });

    // (200 * 100 / 1000) + (800 * 30 / 1000) + (500 * 200 / 1000)
    // = 20 + 24 + 100 = 144
    assert.strictEqual(credits, 144);
  });

  test('ceil rounds up fractional credits', () => {
    const pricing = {
      id: '1',
      model: 'gpt-4o',
      modelProvider: 'openai',
      promptPricePer1kTokens: 1,
      completionPricePer1kTokens: 1,
      isActive: true,
      effectiveFrom: new Date(),
      effectiveUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const credits = pricingService.calculateCredits({
      promptTokens: 1,
      completionTokens: 1,
    }, pricing as any);

    // (1 * 1 / 1000) + (1 * 1 / 1000) = 0.002 -> ceil = 1
    assert.strictEqual(credits, 1);
  });
});

describe('BillingService', () => {
  let originalDb: any;

  beforeEach(() => {
    originalDb = (billingService as any).constructor.prototype;
  });

  afterEach(() => {
    // Restore any mocks
  });

  test('getDefaultCacheRatios returns hardcoded fallback ratios', () => {
    // Verify default cache ratios are hardcoded fallbacks
    const openai = pricingService.getDefaultCacheRatios('openai');
    assert.strictEqual(openai?.hit, 0.5);
    assert.strictEqual(openai?.creation, 0);

    const anthropic = pricingService.getDefaultCacheRatios('anthropic');
    assert.strictEqual(anthropic?.hit, 0.1);
    assert.strictEqual(anthropic?.creation, 1.25);
  });

  test('calculateCredits handles zero tokens', () => {
    const pricing = {
      id: '1',
      model: 'gpt-4o',
      modelProvider: 'openai',
      promptPricePer1kTokens: 100,
      completionPricePer1kTokens: 200,
      isActive: true,
      effectiveFrom: new Date(),
      effectiveUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const credits = pricingService.calculateCredits({
      promptTokens: 0,
      completionTokens: 0,
    }, pricing as any);

    assert.strictEqual(credits, 0);
  });
});
