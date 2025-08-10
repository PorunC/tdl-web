import { create } from 'zustand'

export interface ChatInfo {
  id: string
  title: string
  type: 'private' | 'group' | 'channel'
  username?: string
}

export interface DownloadConfig {
  urls: string[]
  files?: string[] // JSON export files
  fileTypes: string[]
  filter: string
  downloadPath: string
  template: string
  include?: string[]
  exclude?: string[]
  takeout?: boolean
  continue?: boolean // Resume downloads
  desc?: boolean // Download order (newest first)
}

export interface DownloadError {
  file: string
  message: string
  timestamp: string
}

export interface DownloadStatistics {
  filesTotal: number
  filesCompleted: number
  filesSkipped: number
  filesFailed: number
  errors: DownloadError[]
  fingerprint?: string // For resume functionality
}

export interface FileProgress {
  currentFile: string
  fileIndex: number
  totalFiles: number
  fileProgress: number
}

export interface Task {
  id: string
  type: 'download' | 'upload'
  name: string
  status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled' | 'paused'
  progress: number
  speed: string
  eta: string
  transferred: number
  total: number
  createdAt: string
  error?: string
  
  // Download-specific fields
  chatInfo?: ChatInfo
  downloadConfig?: DownloadConfig
  statistics?: DownloadStatistics
  fileProgress?: FileProgress
  resumable?: boolean
}

interface TaskState {
  tasks: Task[]
  addTask: (task: Task) => void
  updateTask: (id: string, updates: Partial<Task>) => void
  removeTask: (id: string) => void
  clearCompletedTasks: () => void
  
  // Download-specific methods
  pauseTask: (id: string) => void
  resumeTask: (id: string) => void
  retryTask: (id: string) => void
  updateFileProgress: (id: string, fileProgress: FileProgress) => void
  addDownloadError: (id: string, error: DownloadError) => void
  getDownloadTasks: () => Task[]
  getTaskById: (id: string) => Task | undefined
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],

  addTask: (task) => {
    set((state) => ({
      tasks: [task, ...state.tasks]
    }))
  },

  updateTask: (id, updates) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id ? { ...task, ...updates } : task
      )
    }))
  },

  removeTask: (id) => {
    set((state) => ({
      tasks: state.tasks.filter((task) => task.id !== id)
    }))
  },

  clearCompletedTasks: () => {
    set((state) => ({
      tasks: state.tasks.filter((task) => 
        !['completed', 'error', 'cancelled'].includes(task.status)
      )
    }))
  },

  // Download-specific methods
  pauseTask: (id) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id ? { ...task, status: 'paused' as const } : task
      )
    }))
  },

  resumeTask: (id) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id ? { ...task, status: 'running' as const } : task
      )
    }))
  },

  retryTask: (id) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id ? { 
          ...task, 
          status: 'pending' as const,
          progress: 0,
          transferred: 0,
          error: undefined,
          statistics: task.statistics ? {
            ...task.statistics,
            errors: []
          } : undefined
        } : task
      )
    }))
  },

  updateFileProgress: (id, fileProgress) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id ? { ...task, fileProgress } : task
      )
    }))
  },

  addDownloadError: (id, error) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id ? {
          ...task,
          statistics: {
            ...task.statistics,
            filesTotal: task.statistics?.filesTotal || 0,
            filesCompleted: task.statistics?.filesCompleted || 0,
            filesSkipped: task.statistics?.filesSkipped || 0,
            filesFailed: (task.statistics?.filesFailed || 0) + 1,
            errors: [...(task.statistics?.errors || []), error]
          }
        } : task
      )
    }))
  },

  getDownloadTasks: () => {
    return get().tasks.filter(task => task.type === 'download')
  },

  getTaskById: (id) => {
    return get().tasks.find(task => task.id === id)
  }
}))