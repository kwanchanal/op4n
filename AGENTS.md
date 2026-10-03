# AGENTS.md - openme / op4n.me

This repository contains product description, frontend, and product logic for
**openme**, a link creation and management dashboard for shortening URLs,
generating QR codes, tracking engagement, and managing branded link pages.

Primary product domain: `op4n.me`
Repository remote: `https://github.com/kwanchanal/op4n`

# op4n.me

## Our Product

We make link as a product.  
We make links short, shareable, trackable — and truly yours

---

## Product Description

op4n.me is a link management platform that turns any URL into a short, shareable, and trackable link  

op4n.me treats links-first as a core product — enabling identity, analytics, and extensibility into richer digital experiences.  

op4n.me is built for creators, businesses, and builders, helps them distribute content better, understand your audience, and own your digital presence.

---

## Problem

Everyone has links — but most of them are:

- Not designed for sharing  
- Long and shucky, can be messy sometimes  
- No Invisible (no insight into clicks or users)  

---

## Our Solution

**Make your link better**

---

## Our Features

### Free
- Link Shortener  
- Built-in Analytics (click tracking)

### Upgrade
- Custom Domain  
- Branded links

### Other
- Landing Page Design (coming soon)

---

## Our DNA

We do only one thing — links. And we try to make it well.

---

Reference products:
- `shorturl.at` for the minimal paste URL -> shorten -> copy experience
- `app.bitly.com` for managed dashboard patterns, analytics, branding, and link lifecycle tooling

When reference copy in the PRD says "Bitly", treat it as reference language unless
the task explicitly asks to reproduce that wording. Prefer `openme` and
`op4n.me` in product UI and implementation.

---

## Product Promise

openme helps users turn long URLs into short, shareable links in seconds, then
manage those links from a centralized dashboard.

Core promise:
- Paste a long URL
- Create a short link
- Copy and share it immediately
- Optionally create a QR code
- Track and manage link performance over time

The product must keep the quick-create flow low friction while gradually exposing
advanced features such as custom back-halves, QR codes, pages, analytics,
integrations, AI assistance, and paid upgrades.

---

## Personas

### Primary Persona: Normal Internet User / Digital Marketer

Example: "Kwanchanok"

Needs to shorten long URLs for social media, email campaigns, printed materials,
or everyday sharing. This user is likely on the free plan and should discover the
value of advanced features progressively.

### Secondary Persona: Growth-Focused Power User

Needs campaign tracking, custom branded pages, bulk link creation, integrations,
deeper analytics, and branded domains. This persona is the target for contextual
upgrade prompts.

---

## Product Structure

### Sidebar Navigation

A vertical icon-based sidebar is fixed to the left edge of every page. Icon-only
items must include hover tooltips and keyboard-accessible labels.

Routes:
- `+` Create new: opens creation context menu
- `/discover`: Discover what openme provides
- `/links`: default landing page after login
- `/trackings`: analytics for links
- `/launchpads`: link-in-bio / branded landing pages
- `/settings/profile`: account preferences

### Global Top Navigation

Persistent across dashboard pages:
- Global heading / promotional text
- Greeting copy such as "Hello, Tell the world what you do"

### Default Landing

The default authenticated dashboard experience is `/links`. Users do not need to
log in to land on Home/Links, but after sign-up/login this page becomes the main
action hub.

---

## Core Journey 1: Home Quick Create

The `/links` dashboard must present link creation as the primary above-the-fold
action.

Required elements:
- Destination URL input with placeholder `https://example.com/my-long-url`
- Fixed free-tier domain indicator for `op4n.me` with a lock icon
- Usage indicator, for example: "You can create 3 more links this month."
- Primary CTA to create a short link
- Optional unchecked checkbox: "Also create a QR Code for this link"
- Contextual upgrade banner: "Get custom links and a complimentary domain" with
  an "Upgrade now" link

Success state:
- Display the created short link immediately
- Provide a one-click Copy button using the Clipboard API
- Show transient copy/create confirmation via toast or inline message
- Decrement the usage counter in real time

Validation and limits:
- Validate URL format before submission
- Show inline errors for blank or malformed URLs
- Enforce free-tier monthly link caps with clear inline or modal messaging
- QR co-creation checkbox defaults to unchecked

Performance and accessibility:
- Dashboard should load within 2 seconds on standard broadband
- Navigation must be keyboard accessible
- Icon-only navigation must expose tooltip labels on hover/focus

---

## Core Journey 2: Dedicated Link Creation

Route: `/links/create`

Entry points:
- `+ Create new` from the sidebar
- "Create link" from `/links`
- Enter shortcut from the Home quick-create URL field

This page is a standalone full-page form, not a modal.

Page requirements:
- Heading: "Create a new link"
- Destination URL field receives focus on load
- "Bulk upload" button with upload icon is anchored top-right
- Three expanded-by-default collapsible sections:
  - Link details
  - Sharing options
  - Advanced settings
- Sticky bottom action bar with Cancel and Create buttons
- Collapsed section state persists for the session

### Link Details

Show a quota alert near the top:
"You have 3 links and 3 custom back-halves remaining this month." Include an
"Upgrade for more" link.

Fields:
- Destination URL, required URL text input
- Keyboard hint: "Hit Enter to create"
- Short link domain dropdown, defaulting to `op4n.me` for openme
- Back-half input for optional custom slug
- Slash separator between domain and back-half to preview the final short link
- Generate button for AI-generated back-half suggestions
- Title optional text input for internal library display/search

Validation:
- Destination URL must be non-empty and a valid URL
- Back-half allows alphanumeric characters and hyphens only
- No spaces or special characters in back-half
- Domain + slash + back-half preview updates as the user types
- Back-half uniqueness validates on blur with 300ms debounce
- Free-tier Generate click must open an upgrade prompt
- Quota alert updates in real time after link creation

### Sharing Options

Two independent toggle rows, both OFF by default:

Generate a QR Code:
- Icon: QR code image or clear QR symbol
- Quota badge such as "2 left"
- Tooltip explains current plan quota and includes upgrade link
- QR quota is consumed at link creation time, not toggle time
- If quota is zero, toggle is disabled with explanatory tooltip and upgrade link

Add to a Page:
- Icon: stacked pages illustration or equivalent
- Enabling surfaces an inline page selector
- If user has no pages, show inline prompt to create a new page
- Must not navigate away when enabled

### Advanced Settings

Paid-only toggles on free tier:
- UTM parameters
- Link expiration

Free-tier behavior:
- Toggles render visually disabled
- Crown/upgrade icon appears beside each label
- Clicking disabled toggle or crown opens upgrade prompt or pricing page
- Disabled state must be visually distinct from an active-off toggle

Paid-tier behavior:
- UTM parameters expand inline with fields:
  - `utm_source`
  - `utm_medium`
  - `utm_campaign`
  - `utm_term`
  - `utm_content`
- Link expiration expands inline with date/time picker
- Expired links stop redirecting and show an expired-link page

### Sticky Bottom Action Bar

Always fixed to the viewport bottom without overlapping content.

Actions:
- Cancel: secondary outlined button, returns to `/links` without confirmation
- Create your link: primary button, validates form, creates link, then navigates
  to `/links` with the new card at the top

Requirements:
- Create button disabled until Destination URL is valid
- Show loading spinner during submission
- Prevent duplicate submissions
- On success, show toast with one-click copy button for the new short link
- On failure, preserve all form data and show contextual error

### Bulk Upload

Power-user batch creation flow.

Requirements:
- Accept CSV files
- Provide downloadable CSV template
- Validate rows before creation
- Show valid/invalid row summary before any links are created
- Gate bulk upload on the free tier with a clear upgrade prompt
- Handle partial failures by creating valid rows and reporting failed rows

---

## Core Journey 3: Format Selection

Users can choose between:
- Short link, default
- QR Code

Requirements:
- Use a segmented radio control at the top of the creation area
- Selecting QR Code switches to a QR-specific form
- Mode persists for the session when navigating away and back
- Both modes are accessible from the `+ Create` sidebar action

---

## Core Journey 4: AI Assist

A floating right-hand "openme Assist" panel may appear in the dashboard.

Free-tier behavior:
- Panel is visible but gated
- Shows upgrade prompt for AI capabilities:
  - Analytics and performance insights
  - AI-assisted link creation and optimization
  - QR code and branded content generation
  - Trend and pattern discovery
- "View plans" CTA deep-links to the correct pricing page
- Chat input is present but gated
- Placeholder: "Paste a long URL to shorten, or ask about your link performance..."
- Disclaimer: "openme Assist can make mistakes. Always verify your links, codes, and data."
- Dismissible with close button

Use a sparkle icon consistently to signal AI-gated functionality.

---

## Core Journey 5: Onboarding Progress

The right column of the home dashboard may include an onboarding widget.

Widget content:
- "Hi [First Name], get started with openme"
- Circular progress indicator, for example 67%
- Checklist:
  - Link shortened: completed
  - Collect 10 clicks or scans: in progress, 0/10, with progress bar
  - Analytics preview: completed
- Inline CTAs:
  - Share first link
  - View links

Requirements:
- Recalculate progress dynamically
- Each checklist item links to the relevant feature or action
- Widget is dismissible once progress reaches 100%
- CTAs navigate to correct sub-sections

---

## Core Journey 6: Integrations Discovery

Dashboard may include a horizontal "Connect your account" carousel.

Categories:
- Recommended for you: Chrome Extension, Canva, Shopify, with data-driven "New" badge
- Social Media Faves: Sprout Social, HubSpot, Adobe Express
- Automation Must-Haves: Zapier, IFTTT, Make
- AI Assistant Essentials: ChatGPT, Claude, Microsoft Copilot

Requirements:
- Touch/swipe-friendly on mobile
- Cards navigate to dedicated marketplace pages
- New badges are configurable by content data
- Carousel auto-pauses on hover/focus
- Include dot indicators and previous/next controls

---

## Links Library

Route: `/links`

User goal: review, manage, organize, and act on all short links.

Page requirements:
- Heading: "openme Links" or equivalent product-native heading
- "Create link" button anchored top-right
- Load full link inventory on arrival
- Default view shows Active links only
- Support pagination or infinite scroll for large volumes

### Search and Filters

Top controls:
- Search links input
- Filter by created date
- Add filters panel

Search requirements:
- Filter by title, destination URL, or short-link slug
- Debounce search by at least 300ms

Filter panel:
- Tags multi-select
- Link type dropdown
- Attached QR Code dropdown: with/without
- Link expiration radio group: expired, expiring, no expiration
- Actions: Clear all filters, Cancel, Apply

Filter behavior:
- Filters are composable
- Active filter state persists through the browser session
- Active filters are visually indicated
- Panel dismisses via Escape, Cancel, or outside click
- Tag options come from the user's tag library

### Bulk Toolbar

Toolbar elements:
- Select all checkbox
- Selected count, for example "0 selected"
- Bulk actions:
  - Export, paid-only with lock icon and upgrade tooltip
  - Hide
  - Tag
- View layout radio group:
  - Compact view
  - Default view
  - Grid view
- Status dropdown, default "Show: Active"

Requirements:
- Bulk actions are disabled when zero links are selected
- Select all selects all links in the current filtered view, not just visible rows
- Layout preference persists via localStorage or user profile settings
- Export shows an upgrade prompt instead of failing silently

### Link Cards

Default card view should make the user's key actions obvious:
- Title or fallback domain/page title
- Destination URL
- Short link
- Copy action
- Click/scan summary where available
- Created date
- Status
- QR/page attachment indicators where available
- Selection checkbox for bulk actions
- Overflow actions for edit, hide, tag, or delete where supported

---

## Data Model Guidance

Use structured link records. Keep implementation modular so quick-create,
dedicated create, library cards, analytics, QR code state, and pages can share
the same data shape.

Suggested link shape:

```json
{
  "id": "link_123",
  "title": "Spring campaign",
  "destinationUrl": "https://example.com/my-long-url",
  "shortDomain": "op4n.me",
  "backHalf": "spring-campaign",
  "shortUrl": "https://op4n.me/spring-campaign",
  "status": "active",
  "createdAt": "2026-04-13T00:00:00.000Z",
  "tags": [],
  "qrCodeId": null,
  "pageIds": [],
  "utm": null,
  "expiresAt": null,
  "analytics": {
    "clicks": 0,
    "scans": 0
  }
}
```

Suggested quota shape:

```json
{
  "plan": "free",
  "linksRemaining": 3,
  "customBackHalvesRemaining": 3,
  "qrCodesRemaining": 2,
  "bulkUploadEnabled": false,
  "aiEnabled": false,
  "exportEnabled": false
}
```

---

## Design System

Visual direction:
- Clean SaaS dashboard
- Minimal, soft, high whitespace
- Neutral base with content and primary actions standing out
- Avoid overly colorful UI

Typography:
- Modern sans-serif
- Inter or system UI stack preferred

Components:
- Buttons similar to shadcn/ui
- Cards with subtle borders/shadows
- Minimal toggles
- Clear inline validation
- Toasts for transient success/error feedback

Icons:
- Prefer Google Material Icons / Material Symbols already used in the repo
- Use lock icon for free-tier restrictions
- Use crown/upgrade icon for paid advanced settings
- Use sparkle icon for AI features

Color:
- Neutral white/gray base
- Dark or navy primary CTA
- Paid/gated states should be clear but not distracting

---

## Interaction Rules

Must do:
- Make quick link creation possible within seconds
- Keep advanced features discoverable but non-blocking
- Preserve user input on failed submissions
- Update quotas and counters in real time after creation
- Use inline validation for URL and back-half errors
- Keep keyboard accessibility for navigation, forms, toggles, and dismissible panels
- Persist session preferences such as filters, collapsed sections, and creation mode

Must not do:
- Do not silently fail gated features
- Do not force navigation for inline options like Add to Page
- Do not clear forms after errors
- Do not make paid prompts block the core free link-shortening action
- Do not overcomplicate the primary paste URL -> create -> copy path

---

## Build Priority

1. `/links` dashboard with quick-create panel
2. URL validation, result state, copy button, and quota counter
3. Link library cards with search and active status filtering
4. `/links/create` full-page form with collapsible sections
5. QR code co-creation and quota behavior
6. Upgrade prompts for gated features
7. Bulk toolbar and view layout persistence
8. AI Assist, onboarding widget, and integrations carousel
9. Bulk upload flow
10. Deeper analytics and tracking pages

---

## Developer Notes

- Prioritize speed over perfection, but keep the product flow coherent.
- Ship the simplest working path first: create a short link and copy it.
- Keep naming product-native: openme / `op4n.me`.
- Treat Bitly and shorturl.at as references, not brand names to copy by default.
- Keep UI behavior modular around link records, quotas, filters, and feature gates.
- Favor inline, contextual upgrade prompts over disruptive paywalls.
- Avoid unrelated refactors when implementing a PRD slice.

---

End of file.
