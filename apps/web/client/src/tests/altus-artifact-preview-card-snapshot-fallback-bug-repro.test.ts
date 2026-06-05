/**
 * Bug 复现测试：截图失败后错误地 fallback 到 raw HTML iframe
 *
 * 问题场景：
 * 1. 用户创建了一个需要服务器运行的网站（有 package.json 启动脚本）
 * 2. E2B sandbox 中启动命令执行失败（exit status 1），端口未就绪
 * 3. 后端返回 snapshot: { status: "capture_failed", reasonCode: "preview_port_not_ready" }
 * 4. 旧的 hasPreviewFallback 逻辑只要 snapshotIssue 存在 + previewPath 存在就进入 raw iframe
 * 5. 结果：用户可能看到 "exit status 1" 错误输出被当作网页内容展示
 *
 * 修复后：
 * - 只有 capture_unavailable + preview_start_command_missing 才允许 raw HTML fallback
 * - capture_failed / preview_port_not_ready 等表示网站本应有服务器，不应 fallback
 */

import { describe, expect, it } from "vitest";
import {
  canUseSimpleHtmlSnapshotFallback,
  getWebsitePreviewSnapshotIssue,
} from "../components/AltusArtifactPreviewCard";

describe("BUG 复现：exit status 1 截图失败后不应进入 raw HTML fallback", () => {
  /**
   * ============ 场景 1：preview_port_not_ready（服务器启动失败）============
   *
   * 这是核心的 bug 场景。
   * E2B sandbox 中执行 npm run dev 失败，端口 45 秒内未就绪。
   * 后端返回 capture_failed + preview_port_not_ready。
   *
   * 旧逻辑：snapshotIssue 存在 && previewPath 存在 → hasPreviewFallback = true
   *         → 直接渲染 raw HTML iframe → 用户看到错误的/不完整的页面
   *
   * 新逻辑：canUseSimpleHtmlSnapshotFallback 检查 reasonCode 必须是
   *         preview_start_command_missing → 返回 false → 不进入 fallback
   */
  it("[BUG 复现] preview_port_not_ready 时不应允许 raw HTML fallback", () => {
    const snapshot = {
      kind: "website_screenshot" as const,
      status: "capture_failed" as const,
      reasonCode: "preview_port_not_ready",
      message: "网站预览服务端口未在限定时间内就绪",
      source: {
        sandboxId: "sandbox-123",
        port: 3000,
        command: "npm run dev",
        logPath: "/tmp/oneceo-preview-run-1.log",
      },
    };

    // 旧逻辑：Boolean(snapshotIssue && previewPath)
    // snapshotIssue 存在（capture_failed）+ previewPath 存在 → true ❌
    const snapshotIssue = getWebsitePreviewSnapshotIssue(snapshot, {
      hasPreviewPath: true,
    });
    expect(snapshotIssue).not.toBeNull(); // 确实有 issue
    const oldHasPreviewFallback = Boolean(snapshotIssue && true); // previewPath = true
    expect(oldHasPreviewFallback).toBe(true); // ❌ 旧逻辑错误地允许 fallback

    // 新逻辑：canUseSimpleHtmlSnapshotFallback
    // reasonCode 不是 preview_start_command_missing → false ✓
    const newHasPreviewFallback = canUseSimpleHtmlSnapshotFallback(snapshot, {
      hasPreviewPath: true,
    });
    expect(newHasPreviewFallback).toBe(false); // ✓ 正确阻止 fallback
  });

  /**
   * ============ 场景 2：chromium_capture_failed（Chromium 截图失败）============
   *
   * 服务器启动成功了，但 Chromium 截图过程中出错（如内存不足、页面崩溃）。
   * 这种情况下也不应该 fallback 到 raw HTML，因为网站是需要服务器运行的。
   */
  it("[BUG 复现] chromium_capture_failed 时不应允许 raw HTML fallback", () => {
    const snapshot = {
      kind: "website_screenshot" as const,
      status: "capture_failed" as const,
      reasonCode: "chromium_capture_failed",
      message: "exit status 1",
      source: {
        sandboxId: "sandbox-123",
        port: 3000,
        command: "npm run dev",
      },
    };

    const snapshotIssue = getWebsitePreviewSnapshotIssue(snapshot, {
      hasPreviewPath: true,
    });
    expect(snapshotIssue).not.toBeNull();

    const oldHasPreviewFallback = Boolean(snapshotIssue && true);
    expect(oldHasPreviewFallback).toBe(true); // ❌ 旧逻辑错误地允许 fallback

    const newHasPreviewFallback = canUseSimpleHtmlSnapshotFallback(snapshot, {
      hasPreviewPath: true,
    });
    expect(newHasPreviewFallback).toBe(false); // ✓ 正确阻止 fallback
  });

  /**
   * ============ 场景 3：storage_failed（R2 存储失败）============
   *
   * 截图成功，但上传到 R2 失败。这也不应该 fallback。
   */
  it("[BUG 复现] storage_failed 时不应允许 raw HTML fallback", () => {
    const snapshot = {
      kind: "website_screenshot" as const,
      status: "storage_failed" as const,
      reasonCode: "preview_snapshot_storage_failed",
      message: "R2 upload failed: Connection timeout",
    };

    const snapshotIssue = getWebsitePreviewSnapshotIssue(snapshot, {
      hasPreviewPath: true,
    });
    expect(snapshotIssue).not.toBeNull();

    const oldHasPreviewFallback = Boolean(snapshotIssue && true);
    expect(oldHasPreviewFallback).toBe(true); // ❌ 旧逻辑错误地允许 fallback

    const newHasPreviewFallback = canUseSimpleHtmlSnapshotFallback(snapshot, {
      hasPreviewPath: true,
    });
    expect(newHasPreviewFallback).toBe(false); // ✓ 正确阻止 fallback
  });

  /**
   * ============ 场景 4：visual check 失败（页面白屏/错误）============
   *
   * 截图成功但视觉检测失败（如 React 报错导致白屏）。
   * 返回 capture_failed + preview_visual_check_failed。
   */
  it("[BUG 复现] visual check 失败时不应允许 raw HTML fallback", () => {
    const snapshot = {
      kind: "website_screenshot" as const,
      status: "capture_failed" as const,
      reasonCode: "preview_visual_check_failed",
      message: "app_runtime_error: 页面浏览器运行时报错：React is not defined",
      visualCheck: {
        status: "failed" as const,
        reasonCode: "app_runtime_error",
        message: "页面浏览器运行时报错：React is not defined",
      },
    };

    const snapshotIssue = getWebsitePreviewSnapshotIssue(snapshot, {
      hasPreviewPath: true,
    });
    expect(snapshotIssue).not.toBeNull();

    const oldHasPreviewFallback = Boolean(snapshotIssue && true);
    expect(oldHasPreviewFallback).toBe(true); // ❌ 旧逻辑错误地允许 fallback

    const newHasPreviewFallback = canUseSimpleHtmlSnapshotFallback(snapshot, {
      hasPreviewPath: true,
    });
    expect(newHasPreviewFallback).toBe(false); // ✓ 正确阻止 fallback
  });

  /**
   * ============ 场景 5：正确的 fallback 场景（简单 HTML 文件）============
   *
   * 这是一个纯静态 HTML 文件，没有启动命令。
   * 后端返回 capture_unavailable + preview_start_command_missing。
   * 这种情况下允许 raw HTML fallback 是正确的。
   */
  it("[正确场景] preview_start_command_missing 时允许 raw HTML fallback", () => {
    const snapshot = {
      kind: "website_screenshot" as const,
      status: "capture_unavailable" as const,
      reasonCode: "preview_start_command_missing",
      message: "未找到可识别的网站启动命令或 HTML 预览文件",
    };

    // capture_unavailable + hasPreviewPath=true 时，getWebsitePreviewSnapshotIssue
    // 返回 null（不是 issue），因为这是一个简单 HTML 文件，不需要截图
    const snapshotIssue = getWebsitePreviewSnapshotIssue(snapshot, {
      hasPreviewPath: true,
    });
    expect(snapshotIssue).toBeNull();

    // 旧逻辑：hasPreviewFallback = Boolean(snapshotIssue && previewPath)
    // snapshotIssue 为 null → false，所以旧逻辑在这个场景下不会进入 fallback
    // 但注意：旧代码里 hasPreviewFallback 是独立计算的，不完全依赖 snapshotIssue
    const oldHasPreviewFallback = Boolean(snapshotIssue && true);
    expect(oldHasPreviewFallback).toBe(false); // 旧逻辑也不会触发（因为没 issue）

    // 新逻辑：canUseSimpleHtmlSnapshotFallback 明确检查 reasonCode
    const newHasPreviewFallback = canUseSimpleHtmlSnapshotFallback(snapshot, {
      hasPreviewPath: true,
    });
    expect(newHasPreviewFallback).toBe(true); // 新逻辑允许 fallback ✓
  });

  /**
   * ============ 场景 6：没有 previewPath 时都不允许 fallback ============
   */
  it("没有 previewPath 时即使 reasonCode 匹配也不允许 fallback", () => {
    const snapshot = {
      kind: "website_screenshot" as const,
      status: "capture_unavailable" as const,
      reasonCode: "preview_start_command_missing",
      message: "未找到可识别的网站启动命令或 HTML 预览文件",
    };

    const newHasPreviewFallback = canUseSimpleHtmlSnapshotFallback(snapshot, {
      hasPreviewPath: false, // 没有 HTML 文件
    });
    expect(newHasPreviewFallback).toBe(false); // ✓ 正确阻止
  });

  /**
   * ============ 场景 7：snapshot 不是 website_screenshot 类型 ============
   */
  it("非 website_screenshot 类型不允许 fallback", () => {
    const snapshot = {
      kind: "browser_action_screenshot" as const,
      status: "capture_failed" as const,
      reasonCode: "preview_port_not_ready",
    };

    const newHasPreviewFallback = canUseSimpleHtmlSnapshotFallback(
      snapshot as any,
      { hasPreviewPath: true },
    );
    expect(newHasPreviewFallback).toBe(false); // ✓ 正确阻止
  });
});
