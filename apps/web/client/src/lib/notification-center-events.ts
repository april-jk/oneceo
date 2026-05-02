export const OPEN_NOTIFICATION_CENTER_EVENT = "oneceo:open-notification-center";
export const CLOSE_NOTIFICATION_CENTER_EVENT = "oneceo:close-notification-center";
export const NOTIFICATION_READ_EVENT = "oneceo:notification-read";

export function openNotificationCenter() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_NOTIFICATION_CENTER_EVENT));
}

export function closeNotificationCenter() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CLOSE_NOTIFICATION_CENTER_EVENT));
}

export function notifyNotificationRead() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NOTIFICATION_READ_EVENT));
}