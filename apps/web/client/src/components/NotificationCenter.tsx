import { useState, useEffect, useCallback } from 'react';
import { Bell, Check, CheckCheck, X } from 'lucide-react';
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
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  // 监听打开/关闭事件
  useEffect(() => {
    const handleOpen = () => setOpen(true);
    const handleClose = () => setOpen(false);

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
      if (filter === 'unread') {
        params.append('unreadOnly', 'true');
      }

      const response = await fetch(`/api/notifications?${params}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('获取通知失败');
      const data = await response.json();

      if (append) {
        setNotifications((prev) => [...prev, ...data.items]);
      } else {
        setNotifications(data.items || []);
      }
      setUnreadCount(data.unreadCount || 0);
      setHasMore((data.items || []).length === 20);
    } catch (error) {
      console.error('获取通知失败:', error);
    } finally {
      setLoading(false);
    }
  }, [filter]);

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
      setFilter('all');
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
    } catch (error) {
      console.error('标记全部已读失败:', error);
    }
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
            <Bell className="w-5 h-5" />
            <h2 className="text-lg font-semibold">通知中心</h2>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="ml-2">
                {unreadCount > 99 ? '99+' : unreadCount}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
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

        {/* 筛选标签 */}
        <div className="flex gap-2 px-4 py-2 border-b">
          <Button
            variant={filter === 'all' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => { setFilter('all'); setPage(1); fetchNotifications(1); }}
          >
            全部
          </Button>
          <Button
            variant={filter === 'unread' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => { setFilter('unread'); setPage(1); fetchNotifications(1); }}
          >
            未读
            {unreadCount > 0 && (
              <Badge variant="secondary" className="ml-1">
                {unreadCount}
              </Badge>
            )}
          </Button>
        </div>

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
                  onClick={() => {
                    if (!notification.isRead) {
                      handleMarkAsRead(notification.id);
                    }
                  }}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-lg">{getTypeIcon(notification.type)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3
                          className={`text-sm font-medium truncate ${
                            !notification.isRead ? 'text-gray-900' : 'text-gray-600'
                          }`}
                        >
                          {notification.title}
                        </h3>
                        {!notification.isRead && (
                          <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />
                        )}
                      </div>
                      <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                        {notification.content}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs text-gray-400">
                          {formatTime(notification.publishedAt || notification.createdAt)}
                        </span>
                        <span className={`text-xs ${getPriorityColor(notification.priority)}`}>
                          {notification.priority === 'urgent' ? '紧急' :
                           notification.priority === 'high' ? '高' :
                           notification.priority === 'normal' ? '普通' : '低'}
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
      </div>
    </div>
  );
}