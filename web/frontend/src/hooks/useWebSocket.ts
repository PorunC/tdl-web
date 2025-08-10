import { useEffect, useRef, useCallback } from 'react'
import { useTaskStore } from '@/store/taskStore'
import { toast } from '@/components/ui/use-toast'

interface WebSocketMessage {
  type: string
  data: any
  timestamp: number
}

export function useWebSocket(enabled: boolean) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const { updateTask } = useTaskStore()

  const connect = useCallback(() => {
    // 优化连接逻辑，避免重复连接
    if (!enabled) return
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`
    
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('WebSocket connected')
    }

    ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data)
        handleMessage(message)
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error)
      }
    }

    ws.onclose = () => {
      console.log('WebSocket disconnected')
      // 优化重连机制，避免立即重连导致的重复检查
      if (enabled && !reconnectTimeoutRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null
          connect()
        }, 3000)
      }
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }
  }, [enabled])

  const handleMessage = useCallback((message: WebSocketMessage) => {
    switch (message.type) {
      case 'progress':
        const progressData = message.data
        updateTask(progressData.task_id, {
          progress: progressData.progress,
          speed: progressData.speed,
          eta: progressData.eta,
          transferred: progressData.transferred,
          total: progressData.total,
          status: 'running',
          // Update file progress if available
          ...(progressData.file_progress && {
            fileProgress: {
              currentFile: progressData.file_progress.current_file,
              fileIndex: progressData.file_progress.file_index,
              totalFiles: progressData.file_progress.total_files,
              fileProgress: progressData.file_progress.file_progress
            }
          }),
          // Update statistics if available
          ...(progressData.statistics && {
            statistics: {
              filesTotal: progressData.statistics.files_total || 0,
              filesCompleted: progressData.statistics.files_completed || 0,
              filesSkipped: progressData.statistics.files_skipped || 0,
              filesFailed: progressData.statistics.files_failed || 0,
              errors: progressData.statistics.errors || []
            }
          })
        })
        break

      case 'task_start':
        // 任务开始，可能需要添加新任务到列表
        break

      case 'task_end':
        updateTask(message.data.task_id, {
          status: 'completed',
          progress: 100
        })
        toast({
          title: "任务完成",
          description: `${message.data.task_type} 任务已完成`,
        })
        break

      case 'task_error':
        updateTask(message.data.task_id, {
          status: 'error',
          error: message.data.message
        })
        toast({
          title: "任务错误",
          description: message.data.message,
          variant: "destructive",
        })
        break

      case 'notification':
        const { message: msg, level } = message.data
        toast({
          title: level === 'error' ? "错误" : "通知",
          description: msg,
          variant: level === 'error' ? "destructive" : "default",
        })
        break

      default:
        console.log('Unknown message type:', message.type)
    }
  }, [updateTask])

  useEffect(() => {
    if (enabled) {
      connect()
    } else {
      // 清理连接和定时器
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }

    return () => {
      // 组件卸载时清理资源
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [enabled, connect])

  return wsRef.current
}