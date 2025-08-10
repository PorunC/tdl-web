import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ApiService } from '@/utils/api'

export interface DownloadSettings {
  defaultPath: string
  defaultTemplate: string
  fileTypes: string[]
  filters: string[]
  concurrency: number
  retryCount: number
  continueOnError: boolean
  skipDuplicates: boolean
  rewriteExt: boolean
  desc: boolean
  takeout: boolean
}

interface DownloadState {
  settings: DownloadSettings
  isLoading: boolean
  
  // Actions
  updateSettings: (updates: Partial<DownloadSettings>) => void
  loadSettings: () => Promise<void>
  saveSettings: () => Promise<void>
  resetSettings: () => void
}

const defaultSettings: DownloadSettings = {
  defaultPath: '',
  defaultTemplate: '{DialogID}_{MessageID}_{FileName}',
  fileTypes: ['photo', 'video', 'document', 'audio'],
  filters: ['true'],
  concurrency: 4,
  retryCount: 3,
  continueOnError: true,
  skipDuplicates: true,
  rewriteExt: false,
  desc: false,
  takeout: false
}

export const useDownloadStore = create<DownloadState>()(
  persist(
    (set, get) => ({
      settings: defaultSettings,
      isLoading: false,

      updateSettings: (updates) => {
        set((state) => ({
          settings: { ...state.settings, ...updates }
        }))
      },

      loadSettings: async () => {
        try {
          set({ isLoading: true })
          
          // Load default path from API
          const pathResponse = await ApiService.getDefaultDownloadPath()
          if (pathResponse.data.success) {
            set((state) => ({
              settings: {
                ...state.settings,
                defaultPath: pathResponse.data.data.default_path
              }
            }))
          }
          
          // Load other settings from API if available
          try {
            const settingsResponse = await ApiService.getSettings()
            if (settingsResponse.data.success) {
              const apiSettings = settingsResponse.data.data
              set((state) => ({
                settings: {
                  ...state.settings,
                  ...apiSettings
                }
              }))
            }
          } catch (error) {
            // Settings API might not be implemented yet
            console.warn('Settings API not available:', error)
          }
          
        } catch (error) {
          console.error('Failed to load download settings:', error)
        } finally {
          set({ isLoading: false })
        }
      },

      saveSettings: async () => {
        try {
          set({ isLoading: true })
          await ApiService.updateSettings(get().settings)
        } catch (error) {
          console.error('Failed to save download settings:', error)
          throw error
        } finally {
          set({ isLoading: false })
        }
      },

      resetSettings: () => {
        set({ settings: defaultSettings })
      }
    }),
    {
      name: 'tdl-download-settings',
      partialize: (state) => ({ settings: state.settings }),
    }
  )
)