# Unified workspace plan

**Goal:** Keep capture and block pages in one workspace shell, with the same navigation, profile, and mobile quick capture control.

**Design:** The root app owns the sidebar, topbar, and URL state. The capture view remains mounted so an unsaved quick note survives switching views. Page summaries render in the existing sidebar while the page workspace supplies only the central content. `/pages` and `/pages/:id` stay valid deep links and use browser history without a full reload.

- [x] Add route state and shared navigation to the root shell; keep the capture editor mounted when pages are open.
- [x] Move page list and creation into the shared sidebar, and remove the second page shell.
- [x] Keep mobile quick capture available from a page and preserve page editor drafts while navigating.
- [x] Test browser history, direct page links, desktop layout, mobile navigation, and existing editing flows.
- [x] Update the current UI documentation and verify the production build.
