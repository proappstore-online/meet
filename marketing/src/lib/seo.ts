/** Set for a separately hosted preview artifact; production is the default. */
export const isPreview = process.env.PAS_MARKETING_PREVIEW === 'true'

/** Only public brochure routes belong in discovery, never the runnable app. */
export const publicPaths = ['/', '/privacy/', '/terms/'] as const
