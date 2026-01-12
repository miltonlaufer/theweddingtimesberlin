'use client'

import React, { createContext, useContext, ReactNode, useMemo } from 'react'
import { IRootStore, initializeStore, IRootStoreSnapshot } from './RootStore'

/******************* CONTEXT ***********************/

const StoreContext = createContext<IRootStore | null>(null)

/******************* PROVIDER ***********************/

interface StoreProviderProps {
  children: ReactNode
  initialState?: IRootStoreSnapshot
}

export const StoreProvider: React.FC<StoreProviderProps> = ({ children, initialState }) => {
  /******************* COMPUTED ***********************/

  const store = useMemo(() => initializeStore(initialState), [initialState])

  /******************* RENDER ***********************/

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

/******************* HOOKS ***********************/

export function useStore(): IRootStore {
  const store = useContext(StoreContext)
  if (!store) {
    throw new Error('useStore must be used within a StoreProvider')
  }
  return store
}

export function useArticleStore() {
  const store = useStore()
  return store.articleStore
}

export function useUIStore() {
  const store = useStore()
  return store.uiStore
}
