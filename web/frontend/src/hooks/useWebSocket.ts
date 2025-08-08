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
  const { updateTask } = useTaskStore()

  const connect = useCallback(() => {
    if (!enabled || wsRef.current?.readyState === WebSocket.OPEN) {
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
      // 重连机制
      if (enabled) {
        setTimeout(() => connect(), 3000)
      }
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }
  }, [enabled])

  const handleMessage = useCallback((message: WebSocketMessage) => {
    switch (message.type) {
      case 'progress':
        updateTask(message.data.task_id, {
          progress: message.data.progress,
          speed: message.data.speed,
          eta: message.data.eta,
          transferred: message.data.transferred,
          total: message.data.total,
          status: 'running'
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
    } else if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [enabled, connect])

  return wsRef.current
}