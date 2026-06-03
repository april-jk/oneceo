import { chromium } from '@playwright/test';
import { loadPlaywrightTestAccount } from './test-account.mjs';

const WEB_BASE_URL = process.env.ONECEO_WEB_BASE_URL || 'http://127.0.0.1:3000';
const INITIAL_PROMPT = process.env.ONECEO_CONTEXT_E2E_INITIAL_PROMPT || '帮我做一个管理后台系统';
const CLARIFICATION_ANSWER = process.env.ONECEO_CONTEXT_E2E_CLARIFICATION_ANSWER || '网页应用';
const FOLLOWUP_PROMPT = process.env.ONECEO_CONTEXT_E2E_FOLLOWUP_PROMPT || '按你的想法，先帮我做个方案';
const POLL_INTERVAL_MS = Number(process.env.ONECEO_CONTEXT_E2E_POLL_INTERVAL_MS || 5000);
const FIRST_RUN_TIMEOUT_MS = Number(process.env.ONECEO_CONTEXT_E2E_FIRST_RUN_TIMEOUT_MS || 8 * 60 * 1000);
const FOLLOWUP_TIMEOUT_MS = Number(process.env.ONECEO_CONTEXT_E2E_FOLLOWUP_TIMEOUT_MS || 5 * 60 * 1000);
const ARTIFACT_QUESTION = '这次要交付的是网页应用、后端 API、本地脚本，还是完整业务系统？';
const HOME_PLACEHOLDERS = ['在这里输入你的消息...', 'Enter your message...'];
const ANSWER_PLACEHOLDERS = ['请输入问题回答...', 'Enter your answer...'];
const FOLLOWUP_PLACEHOLDERS = ['继续对话...', 'Continue conversation...'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadTestAccount() {
  return loadPlaywrightTestAccount();
}

function countOccurrences(text, needle) {
  return String(text || '').split(needle).length - 1;
}

async function pageText(page) {
  return page.locator('body').innerText({ timeout: 10_000 }).catch(() => '');
}

async function waitForCondition(label, timeoutMs, fn) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    last = await fn();
    if (last?.ok) return last.value;
    if (last?.snapshot) console.log(`[${label}]`, JSON.stringify(last.snapshot));
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`${label} timed out: ${JSON.stringify(last?.snapshot || last || null)}`);
}

async function loginThroughUi(page, account) {
  await page.goto(`${WEB_BASE_URL}/login?redirect=${encodeURIComponent('/')}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('#login-email').fill(account.email);
  await page.locator('#login-password').fill(account.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
}

async function fillComposerAndSubmit(page, placeholders, value) {
  const result = await page.evaluate(
    ({ placeholders: targetPlaceholders, value: targetValue }) => {
      const textarea =
        targetPlaceholders
          .map((placeholder) => document.querySelector(`textarea[placeholder="${placeholder}"]`))
          .find(Boolean) || (document.querySelectorAll('textarea').length === 1 ? document.querySelector('textarea') : null);
      if (!textarea) return { ok: false, reason: 'textarea_not_found' };

      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), 'value');
      if (descriptor?.set) descriptor.set.call(textarea, targetValue);
      else textarea.value = targetValue;
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: targetValue }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));

      const container = textarea.parentElement;
      const buttons = Array.from(container?.querySelectorAll('button') || []);
      const submit = buttons
        .filter((button) => !button.disabled)
        .findLast((button) => {
          const label = `${button.innerText || ''} ${button.getAttribute('aria-label') || ''}`;
          const loc = button.getAttribute('data-loc') || '';
          return (
            label.includes('发送') ||
            label.includes('提交') ||
            label.includes('Send') ||
            loc.includes('Home.tsx:2204') ||
            loc.includes('HomePage.tsx:234')
          );
        });
      if (!submit) {
        return {
          ok: false,
          reason: 'submit_not_found',
          buttons: buttons.map((button) => ({
            text: button.innerText,
            aria: button.getAttribute('aria-label'),
            loc: button.getAttribute('data-loc'),
            disabled: button.disabled,
          })),
        };
      }
      submit.click();
      return { ok: true };
    },
    { placeholders, value }
  );
  if (!result?.ok) {
    throw new Error(`failed to submit composer ${placeholders.join(' / ')}: ${result?.reason || 'unknown'}`);
  }
}

async function waitForTextarea(page, placeholders, timeoutMs) {
  await waitForCondition(`textarea:${placeholders.join('|')}`, timeoutMs, async () => {
    const counts = await Promise.all(
      placeholders.map(async (placeholder) => ({
        placeholder,
        count: await page.locator(`textarea[placeholder="${placeholder}"]`).count().catch(() => 0),
      }))
    );
    const fallbackCount = await page.locator('textarea').count().catch(() => 0);
    const count = counts.reduce((sum, item) => sum + item.count, 0) || (fallbackCount === 1 ? 1 : 0);
    return {
      ok: count > 0,
      value: count,
      snapshot: { placeholders, counts, fallbackCount, count, url: page.url() },
    };
  });
}

async function waitForInitialClarification(page) {
  return waitForCondition('clarification-ui', FIRST_RUN_TIMEOUT_MS, async () => {
    const text = await pageText(page);
    const answerBoxCount = await page.locator('textarea[placeholder="请输入问题回答..."], textarea[placeholder="Enter your answer..."]').count();
    return {
      ok: text.includes(ARTIFACT_QUESTION) || answerBoxCount > 0,
      value: text,
      snapshot: {
        hasArtifactQuestion: text.includes(ARTIFACT_QUESTION),
        answerBoxCount,
        tail: text.slice(-800),
      },
    };
  });
}

async function waitForExecutionAfterAnswer(page) {
  return waitForCondition('post-answer-ui', FIRST_RUN_TIMEOUT_MS, async () => {
    const text = await pageText(page);
    const repeatedBoundary = countOccurrences(text, ARTIFACT_QUESTION) > 1 || countOccurrences(text, '需要补充信息') > 1;
    const continuedExecution =
      text.includes('更新index.html') ||
      text.includes('更新style.css') ||
      text.includes('执行项目命令') ||
      text.includes('正在分析并执行任务');
    const completed =
      text.includes('managed run 已完成') ||
      text.includes('任务完成') ||
      text.includes('交付文件已生成') ||
      text.includes('已为您完成');
    const failed = text.includes('本次执行失败') || text.includes('运行失败') || text.includes('insufficient_credits');
    if (repeatedBoundary) {
      throw new Error(`repeated boundary clarification after answer: ${text.slice(-2000)}`);
    }
    if (failed) {
      throw new Error(`managed run failed after answer: ${text.slice(-2000)}`);
    }
    return {
      ok: continuedExecution || completed,
      value: { text, completed },
      snapshot: {
        continuedExecution,
        completed,
        repeatedBoundary,
        tail: text.slice(-1000),
      },
    };
  });
}

async function waitForFirstRunCompletion(page) {
  return waitForCondition('first-run-completion-ui', FIRST_RUN_TIMEOUT_MS, async () => {
    const text = await pageText(page);
    const completed =
      text.includes('managed run 已完成') ||
      text.includes('任务完成') ||
      text.includes('交付文件已生成') ||
      text.includes('已为您完成');
    const failed = text.includes('本次执行失败') || text.includes('运行失败') || text.includes('insufficient_credits');
    if (failed) {
      throw new Error(`managed run failed: ${text.slice(-2000)}`);
    }
    return {
      ok: completed,
      value: text,
      snapshot: { completed, tail: text.slice(-1200) },
    };
  });
}

async function waitForFollowupAccepted(page) {
  return waitForCondition('followup-ui', FOLLOWUP_TIMEOUT_MS, async () => {
    const text = await pageText(page);
    const followupIndex = text.lastIndexOf(FOLLOWUP_PROMPT);
    const afterFollowup = followupIndex >= 0 ? text.slice(followupIndex) : text;
    const repeatedBoundary =
      afterFollowup.includes(ARTIFACT_QUESTION) ||
      afterFollowup.includes('需要补充信息');
    const failed =
      afterFollowup.includes('本次执行失败') ||
      afterFollowup.includes('运行失败') ||
      afterFollowup.includes('insufficient_credits');
    const producingPlan = /方案|阶段|模块|功能|用户管理|权限|后台系统|实施|设计/.test(afterFollowup);
    const completed =
      afterFollowup.includes('managed run 已完成') ||
      afterFollowup.includes('任务完成') ||
      afterFollowup.includes('交付文件已生成');
    if (repeatedBoundary) {
      throw new Error(`follow-up repeated boundary clarification: ${afterFollowup.slice(0, 2500)}`);
    }
    if (failed) {
      throw new Error(`follow-up managed run failed: ${afterFollowup.slice(0, 2500)}`);
    }
    return {
      ok: producingPlan || completed,
      value: { afterFollowup, completed, producingPlan },
      snapshot: {
        completed,
        producingPlan,
        repeatedBoundary,
        tail: afterFollowup.slice(-1200),
      },
    };
  });
}

async function main() {
  const account = await loadTestAccount();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  try {
    await loginThroughUi(page, account);
    await page.goto(WEB_BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForTextarea(page, HOME_PLACEHOLDERS, 60_000);
    await fillComposerAndSubmit(page, HOME_PLACEHOLDERS, INITIAL_PROMPT);
    await page.waitForURL(/\/session\//, { timeout: 120_000 });
    const sessionId = page.url().split('/session/')[1]?.split(/[?#]/)[0];
    if (!sessionId) throw new Error(`failed to resolve session id from ${page.url()}`);
    console.log('[identifiers]', JSON.stringify({ sessionId, webBaseUrl: WEB_BASE_URL }));

    await waitForInitialClarification(page);
    await fillComposerAndSubmit(page, ANSWER_PLACEHOLDERS, CLARIFICATION_ANSWER);
    await waitForExecutionAfterAnswer(page);
    console.log('[context-001]', JSON.stringify({ sessionId, acceptedAnswer: CLARIFICATION_ANSWER }));

    await waitForFirstRunCompletion(page);
    await waitForTextarea(page, FOLLOWUP_PLACEHOLDERS, FOLLOWUP_TIMEOUT_MS);
    await fillComposerAndSubmit(page, FOLLOWUP_PLACEHOLDERS, FOLLOWUP_PROMPT);
    const followup = await waitForFollowupAccepted(page);
    console.log('[context-002]', JSON.stringify({
      sessionId,
      completed: followup.completed,
      producingPlan: followup.producingPlan,
    }));
    console.log('[result] success');
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error('[result] failure', error);
  process.exit(1);
});
