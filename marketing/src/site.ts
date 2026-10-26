/**
 * The marketing site's content and settings. Everything the pages say about the
 * app comes from this file: edit the copy, swap in your own images (put them in
 * public/assets/), or change the pages in src/pages/ directly. Keep claims true —
 * no invented pricing, testimonials, customer counts or reviews; leave an optional
 * section empty and it is left out.
 *
 * The Privacy Policy and Terms are a starting point, not legal advice. Review them
 * against what your app actually does before you rely on them.
 */
export const site = {
  appId: 'meet',
  name: 'Meet',
  appUrl: 'https://meet.proappstore.online/',
  /** Who runs the app; named as the operator on the legal pages and in the footer. */
  owner: 'The Meet team',
  /** Where people can reach you. Leave empty to point them at the app instead. */
  contactEmail: '',
  /** Optional help page or support link shown in the footer. */
  supportUrl: '',
  /** Jurisdiction whose law governs the Terms. Leave empty to omit the clause. */
  governingLaw: '',
  /** Shown on the legal pages; update it whenever you change them. */
  legalUpdated: '2026-10-26',
  /** Brand colours, mapped into the Tailwind theme (bg-accent, text-accent-deep, ...). */
  colors: {
    accent: '#d86f4d',
    /** Buttons and links: dark enough for white text, and for text on paper. */
    accentDeep: '#9f4427',
    accentSoft: '#ffd4bf',
    ink: '#111111',
    muted: '#666666',
    paper: '#ffffff',
    paperDeep: '#f7f7f7',
  },
  headline: 'A simple way to meet one on one.',
  summary: 'Start one-on-one video calls in your browser, share your room link and let friends know when you are available.',
  ctaLabel: 'Open Meet',
  /** Optional hero image, e.g. { src: '/assets/hero.png', alt: '...' }. Without one, a brand-colour panel is shown. */
  heroImage: null as Image | null,
  /** Optional product screenshots, shown in a gallery. */
  screenshots: [] as Image[],
  benefits: [
    { title: 'Talk one on one', body: 'Start a video call in your browser with camera and microphone controls.' },
    { title: 'Share your room link', body: 'Send someone your link so they can join your room.' },
    { title: 'Let friends know you are available', body: 'Use availability mode and optional browser push notifications to coordinate a call.' },
  ],
  howItWorks: [
    { title: 'Open Meet', body: 'Sign in with GitHub or Google in your browser.' },
    { title: 'Invite someone', body: 'Share your room link or let your friends know you are available.' },
    { title: 'Start your call', body: 'Choose when to start, then allow camera and microphone access when your browser asks.' },
  ],
}

interface Image {
  src: string
  alt: string
}

/** How the legal pages tell people to reach you. */
export const contact = site.contactEmail
  ? `email ${site.contactEmail}`
  : `contact us through ${site.appUrl}`
