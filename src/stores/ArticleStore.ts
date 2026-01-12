import { types, flow, Instance, SnapshotIn, SnapshotOut } from 'mobx-state-tree'

/******************* MODELS ***********************/

const CategoryModel = types.model('Category', {
  id: types.identifier,
  name: types.string,
  slug: types.string,
  description: types.maybe(types.string),
  order: types.number,
})

const AuthorModel = types.model('Author', {
  id: types.identifier,
  name: types.string,
  slug: types.string,
  title: types.maybe(types.string),
  bio: types.maybe(types.string),
  photoUrl: types.maybe(types.string),
  email: types.maybe(types.string),
})

const ArticleModel = types.model('Article', {
  id: types.identifier,
  headline: types.string,
  subheadline: types.maybe(types.string),
  slug: types.string,
  featuredImageUrl: types.maybe(types.string),
  imageCaption: types.maybe(types.string),
  content: types.string,
  excerpt: types.maybe(types.string),
  category: CategoryModel,
  author: AuthorModel,
  publishedAt: types.maybe(types.string),
  status: types.enumeration(['draft', 'published']),
  isFeatured: types.boolean,
  isHeadline: types.boolean,
  layout: types.enumeration(['standard', 'wide', 'opinion']),
})

/******************* STORE ***********************/

export const ArticleStore = types
  .model('ArticleStore', {
    articles: types.array(ArticleModel),
    categories: types.array(CategoryModel),
    authors: types.array(AuthorModel),
    isLoading: types.optional(types.boolean, false),
    error: types.maybe(types.string),
    selectedCategorySlug: types.maybe(types.string),
  })
  .views((self) => ({
    /******************* COMPUTED ***********************/

    get publishedArticles() {
      return self.articles.filter((article) => article.status === 'published')
    },

    get headlineArticle() {
      return self.articles.find((article) => article.isHeadline && article.status === 'published')
    },

    get featuredArticles() {
      return self.articles.filter(
        (article) => article.isFeatured && !article.isHeadline && article.status === 'published'
      )
    },

    get regularArticles() {
      return self.articles.filter(
        (article) => !article.isFeatured && !article.isHeadline && article.status === 'published'
      )
    },

    get sortedCategories() {
      return [...self.categories].sort((a, b) => a.order - b.order)
    },

    getArticlesByCategory(categorySlug: string) {
      return self.articles.filter(
        (article) => article.category.slug === categorySlug && article.status === 'published'
      )
    },

    getArticleBySlug(slug: string) {
      return self.articles.find((article) => article.slug === slug)
    },

    getCategoryBySlug(slug: string) {
      return self.categories.find((category) => category.slug === slug)
    },

    getAuthorBySlug(slug: string) {
      return self.authors.find((author) => author.slug === slug)
    },
  }))
  .actions((self) => ({
    /******************* ACTIONS ***********************/

    setLoading(loading: boolean) {
      self.isLoading = loading
    },

    setError(error: string | undefined) {
      self.error = error
    },

    setSelectedCategory(categorySlug: string | undefined) {
      self.selectedCategorySlug = categorySlug
    },

    setArticles(articles: SnapshotIn<typeof ArticleModel>[]) {
      self.articles.replace(articles as Instance<typeof ArticleModel>[])
    },

    setCategories(categories: SnapshotIn<typeof CategoryModel>[]) {
      self.categories.replace(categories as Instance<typeof CategoryModel>[])
    },

    setAuthors(authors: SnapshotIn<typeof AuthorModel>[]) {
      self.authors.replace(authors as Instance<typeof AuthorModel>[])
    },

    fetchArticles: flow(function* () {
      self.isLoading = true
      self.error = undefined
      try {
        const response: Response = yield fetch('/api/articles?where[status][equals]=published&depth=2')
        const data: { docs: SnapshotIn<typeof ArticleModel>[] } = yield response.json()
        self.articles.replace(data.docs as Instance<typeof ArticleModel>[])
      } catch (error) {
        self.error = error instanceof Error ? error.message : 'Failed to fetch articles'
      } finally {
        self.isLoading = false
      }
    }),

    fetchCategories: flow(function* () {
      try {
        const response: Response = yield fetch('/api/categories?sort=order')
        const data: { docs: SnapshotIn<typeof CategoryModel>[] } = yield response.json()
        self.categories.replace(data.docs as Instance<typeof CategoryModel>[])
      } catch (error) {
        console.error('Failed to fetch categories:', error)
      }
    }),

    fetchAuthors: flow(function* () {
      try {
        const response: Response = yield fetch('/api/authors')
        const data: { docs: SnapshotIn<typeof AuthorModel>[] } = yield response.json()
        self.authors.replace(data.docs as Instance<typeof AuthorModel>[])
      } catch (error) {
        console.error('Failed to fetch authors:', error)
      }
    }),

    fetchAll: flow(function* () {
      self.isLoading = true
      self.error = undefined
      try {
        const [articlesRes, categoriesRes, authorsRes]: Response[] = yield Promise.all([
          fetch('/api/articles?where[status][equals]=published&depth=2'),
          fetch('/api/categories?sort=order'),
          fetch('/api/authors'),
        ])
        
        const [articlesData, categoriesData, authorsData] = yield Promise.all([
          articlesRes.json(),
          categoriesRes.json(),
          authorsRes.json(),
        ])
        
        self.articles.replace(articlesData.docs || [])
        self.categories.replace(categoriesData.docs || [])
        self.authors.replace(authorsData.docs || [])
      } catch (error) {
        self.error = error instanceof Error ? error.message : 'Failed to fetch data'
      } finally {
        self.isLoading = false
      }
    }),
  }))

/******************* TYPES ***********************/

export type IArticleStore = Instance<typeof ArticleStore>
export type IArticleStoreSnapshot = SnapshotOut<typeof ArticleStore>
export type IArticleModel = Instance<typeof ArticleModel>
export type ICategoryModel = Instance<typeof CategoryModel>
export type IAuthorModel = Instance<typeof AuthorModel>
