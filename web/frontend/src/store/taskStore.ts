import { create } from 'zustand'

export interface Task {
  id: string
  type: 'download' | 'upload'
  name: string
  status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled'
  progress: number
  speed: string
  eta: string
  transferred: number
  total: number
  createdAt: string
  error?: string
}

interface TaskState {
  tasks: Task[]
  addTask: (task: Task) => void
  updateTask: (id: string, updates: Partial<Task>) => void
  removeTask: (id: string) => void
  clearCompletedTasks: () => void
}

export const useTaskStore = create<TaskState>((set) => ({
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
  }
}))