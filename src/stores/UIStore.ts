import { types, Instance, SnapshotOut } from 'mobx-state-tree'

/******************* STORE ***********************/

export const UIStore = types
  .model('UIStore', {
    isSearchOpen: types.optional(types.boolean, false),
    isMenuOpen: types.optional(types.boolean, false),
    activeSection: types.maybe(types.string),
  })
  .actions((self) => ({
    /******************* ACTIONS ***********************/

    openSearch() {
      self.isSearchOpen = true
    },

    closeSearch() {
      self.isSearchOpen = false
    },

    toggleSearch() {
      self.isSearchOpen = !self.isSearchOpen
    },

    openMenu() {
      self.isMenuOpen = true
    },

    closeMenu() {
      self.isMenuOpen = false
    },

    toggleMenu() {
      self.isMenuOpen = !self.isMenuOpen
    },

    setActiveSection(section: string | undefined) {
      self.activeSection = section
    },
  }))

/******************* TYPES ***********************/

export type IUIStore = Instance<typeof UIStore>
export type IUIStoreSnapshot = SnapshotOut<typeof UIStore>
