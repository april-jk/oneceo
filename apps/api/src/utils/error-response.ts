/**
 * 对外错误信息脱敏，避免将内部实现细节透传给前端
 */

export function getPublicErrorMessage(
  fallback: string = '服务异常，请稍后重试'
): string {
  return fallback;
}

