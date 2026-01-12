import { types, Instance, SnapshotOut, onSnapshot } from 'mobx-state-tree'
import { ArticleStore } from './ArticleStore'
import { UIStore } from './UIStore'

/******************* ROOT STORE ***********************/

export const RootStore = types.model('RootStore', {
  articleStore: types.optional(ArticleStore, {}),
  uiStore: types.optional(UIStore, {}),
})

/******************* TYPES ***********************/

export type IRootStore = Instance<typeof RootStore>
export type IRootStoreSnapshot = SnapshotOut<typeof RootStore>

/******************* STORE INSTANCE ***********************/

let rootStore: IRootStore | undefined

export function initializeStore(snapshot?: IRootStoreSnapshot): IRootStore {
  const _store = rootStore ?? RootStore.create({})

  // If there's a snapshot, apply it
  if (snapshot) {
    // We need to be careful here - only apply if store is fresh
    if (!rootStore) {
      Object.assign(_store, snapshot)
    }
  }

  // For SSR/SSG, always create a new store
  if (typeof window === 'undefined') {
    return _store
  }

  // Create the store once in the client
  if (!rootStore) {
    rootStore = _store

    // Optional: Enable debugging in development
    if (process.env.NODE_ENV === 'development') {
      onSnapshot(rootStore, (snapshot) => {
        console.log('Store snapshot:', snapshot)
      })
    }
  }

  return rootStore
}

export function getStore(): IRootStore {
  if (!rootStore) {
    rootStore = initializeStore()
  }
  return rootStore
}
