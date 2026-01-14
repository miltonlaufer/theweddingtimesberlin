/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'https://theweddingtimesberlin.de',
  generateRobotsTxt: true,
  exclude: ['/admin', '/admin/*', '/api/*'],
}

