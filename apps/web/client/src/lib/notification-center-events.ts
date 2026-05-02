export const OPEN_NOTIFICATION_CENTER_EVENT = "oneceo:open-notification-center";
export const CLOSE_NOTIFICATION_CENTER_EVENT = "oneceo:close-notification-center";

export function openNotificationCenter() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_NOTIFICATION_CENTER_EVENT));
}

export function closeNotificationCenter() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CLOSE_NOTIFICATION_CENTER_EVENT));
}