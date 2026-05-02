import { useState, useEffect, useCallback } from 'react';
import { Bell, Check, CheckCheck, X, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  OPEN_NOTIFICATION_CENTER_EVENT,
  CLOSE_NOTIFICATION_CENTER_EVENT,
} from '@/lib/notification-center-events';

interface Notification {
  id: string;
  title: string;
  content: string;
  type: string;
  priority: string;
  isRead: boolean;
  publishedAt: string | null;
  createdAt: string;
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);

  // 监听打开/关闭事件
  useEffect(() => {
    const handleOpen = () => setOpen(true);
    const handleClose = () => {
      setOpen(false);
      setSelectedNotification(null);
    };

    window.addEventListener(OPEN_NOTIFICATION_CENTER_EVENT, handleOpen);
    window.addEventListener(CLOSE_NOTIFICATION_CENTER_EVENT, handleClose);
    return () => {
      window.removeEventListener(OPEN_NOTIFICATION_CENTER_EVENT, handleOpen);
      window.removeEventListener(CLOSE_NOTIFICATION_CENTER_EVENT, handleClose);
    };
  }, []);

  // 获取通知列表
  const fetchNotifications = useCallback(async (pageNum: number, append = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(pageNum),
        pageSize: '20',
      });

      const response = await fetch(`/api/notifications?${params}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('获取通知失败');
      const data = await response.json();

      // 按未读优先、时间倒序排序
      const sortedItems = (data.items || []).sort((a: Notification, b: Notification) => {
        if (a.isRead !== b.isRead) {
          return a.isRead ? 1 : -1;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      if (append) {
        setNotifications((prev) => [...prev, ...sortedItems]);
      } else {
        setNotifications(sortedItems);
      }
      setUnreadCount(data.unreadCount || 0);
      setHasMore((data.items || []).length === 20);
    } catch (error) {
      console.error('获取通知失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // 获取未读数量
  const fetchUnreadCount = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications/unread-count', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('获取未读数量失败');
      const data = await response.json();
      setUnreadCount(data.count || 0);
    } catch (error) {
      console.error('获取未读数量失败:', error);
    }
  }, []);

  // 打开时加载数据
  useEffect(() => {
    if (open) {
      setPage(1);
      setSelectedNotification(null);
      fetchNotifications(1);
    }
  }, [open, fetchNotifications]);

  // 初始加载未读数量
  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  // 标记单条为已读
  const handleMarkAsRead = async (id: string) => {
    try {
      const response = await fetch(`/api/notifications/${id}/read`, {
        method: 'PUT',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('标记已读失败');

      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));

      // 更新选中的通知
      if (selectedNotification?.id === id) {
        setSelectedNotification((prev) => prev ? { ...prev, isRead: true } : null);
      }
    } catch (error) {
      console.error('标记已读失败:', error);
    }
  };

  // 标记全部为已读
  const handleMarkAllAsRead = async () => {
    try {
      const response = await fetch('/api/notifications/read-all', {
        method: 'PUT',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('标记全部已读失败');

      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);

      // 更新选中的通知
      if (selectedNotification) {
        setSelectedNotification((prev) => prev ? { ...prev, isRead: true } : null);
      }
    } catch (error) {
      console.error('标记全部已读失败:', error);
    }
  };

  // 点击通知
  const handleNotificationClick = (notification: Notification) => {
    setSelectedNotification(notification);
    if (!notification.isRead) {
      handleMarkAsRead(notification.id);
    }
  };

  // 返回列表
  const handleBackToList = () => {
    setSelectedNotification(null);
  };

  // 加载更多
  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchNotifications(nextPage, true);
  };

  // 获取优先级颜色
  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'text-red-500';
      case 'high': return 'text-orange-500';
      case 'normal': return 'text-blue-500';
      case 'low': return 'text-gray-400';
      default: return 'text-gray-400';
    }
  };

  // 获取类型图标
  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'system': return '🔔';
      case 'billing': return '💰';
      case 'task': return '📋';
      case 'security': return '🔒';
      default: return '📢';
    }
  };

  // 获取类型标签
  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'system': return '系统通知';
      case 'billing': return '计费通知';
      case 'task': return '任务通知';
      case 'security': return '安全通知';
      default: return '通知';
    }
  };

  // 获取优先级标签
  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case 'urgent': return '紧急';
      case 'high': return '高';
      case 'normal': return '普通';
      case 'low': return '低';
      default: return '普通';
    }
  };

  // 格式化时间
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString();
  };

  // 格式化完整时间
  const formatFullTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => setOpen(false)}
      />

      {/* 通知中心面板 */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md h-[80vh] max-h-[600px] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            {selectedNotification ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleBackToList}
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
            ) : (
              <Bell className="w-5 h-5" />
            )}
            <h2 className="text-lg font-semibold">
              {selectedNotification ? '通知详情' : '通知中心'}
            </h2>
            {!selectedNotification && unreadCount > 0 && (
              <Badge variant="secondary" className="ml-2">
                {unreadCount > 99 ? '99+' : unreadCount}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!selectedNotification && unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleMarkAllAsRead}
                className="text-sm"
              >
                <CheckCheck className="w-4 h-4 mr-1" />
                全部已读
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setOpen(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* 通知详情视图 */}
        {selectedNotification ? (
          <div className="flex-1 overflow-y-auto">
            <div className="p-5">
              {/* 标题区域 */}
              <div className="mb-4">
                <h2 className="text-base font-semibold text-gray-900 mb-2">
                  {selectedNotification.title}
                </h2>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <span>{formatFullTime(selectedNotification.publishedAt || selectedNotification.createdAt)}</span>
                  <span>·</span>
                  <span>{getTypeLabel(selectedNotification.type)}</span>
                  <span>·</span>
                  <span className={getPriorityColor(selectedNotification.priority)}>
                    {getPriorityLabel(selectedNotification.priority)}
                  </span>
                </div>
              </div>

              {/* 分割线 */}
              <div className="border-t border-gray-100 mb-4" />

              {/* 通知内容 */}
              <div className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                {selectedNotification.content}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* 通知列表 */}
            <ScrollArea className="flex-1">
              {loading && notifications.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-gray-500">
                  加载中...
                </div>
              ) : notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-gray-500">
                  <Bell className="w-8 h-8 mb-2 opacity-50" />
                  <p>暂无通知</p>
                </div>
              ) : (
                <div className="divide-y">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors ${
                        !notification.isRead ? 'bg-blue-50' : ''
                      }`}
                      onClick={() => handleNotificationClick(notification)}
                    >
                      <div className="flex items-start gap-3">
                        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 ${
                          notification.isRead ? 'bg-gray-300' : 'bg-gray-900'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3
                              className={`text-sm font-medium truncate ${
                                !notification.isRead ? 'text-gray-900' : 'text-gray-600'
                              }`}
                            >
                              {notification.title}
                            </h3>
                          </div>
                          <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                            {notification.content}
                          </p>
                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-xs text-gray-400">
                              {formatTime(notification.publishedAt || notification.createdAt)}
                            </span>
                            <span className={`text-xs ${getPriorityColor(notification.priority)}`}>
                              {getPriorityLabel(notification.priority)}
                            </span>
                          </div>
                        </div>
                        {!notification.isRead && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMarkAsRead(notification.id);
                            }}
                          >
                            <Check className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* 加载更多 */}
                  {hasMore && (
                    <div className="px-4 py-3">
                      <Button
                        variant="ghost"
                        className="w-full"
                        onClick={handleLoadMore}
                        disabled={loading}
                      >
                        {loading ? '加载中...' : '加载更多'}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>
          </>
        )}
      </div>
    </div>
  );
}