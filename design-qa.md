# Card layout design QA

- Source visual truth: `/var/folders/6r/04ktqfxx18v8qt0g2tdmx33m0000gn/T/codex-clipboard-8fffca77-97a1-438c-9ff7-0949ad8e8506.png`
- Implementation screenshot: `/Users/atlan/Documents/VaultMesh/design-qa-implementation.png`
- Combined comparison: `/Users/atlan/Documents/VaultMesh/design-qa-comparison.png`
- Browser viewport: 1280 × 720 CSS px; device pixel ratio reported as 2; captured screenshot: 1280 × 720 px
- Source pixels: 798 × 510 px
- Comparison normalization: source fit within 620 × 620 px; implementation cropped to the 620 × 620 px card region
- State: default unlocked-card presentation; six content types; action toolbar hidden until hover or keyboard focus

## Full-view comparison evidence

The rendered set covers Login, Passkey, payment card, SSH, developer secret, and identity cards. All six use the same horizontal card proportion, top icon/title and type mark, centered primary value, and two-column metadata footer. The reference and implementation share the same visible information hierarchy and visual rhythm. VaultMesh's existing theme-owned gradients remain intentional rather than copying the reference's pink artwork.

## Focused-region comparison evidence

The combined comparison focuses on the reference card and the rendered Login/payment-card regions. The top-left identifier, top-right type mark, middle masked value, bottom-left owner/account field, and bottom-right secondary field align with the reference structure. Iconography uses the existing Lucide dependency; no placeholder or hand-drawn asset is used.

## Findings

- Fonts and typography: Passed. Weight, scale, tracking, truncation, and hierarchy match the reference's compact card treatment while retaining the product font stack.
- Spacing and layout rhythm: Passed. Card ratio, 16 px inset, top/middle/bottom distribution, radii, and three-column-safe density are consistent.
- Colors and visual tokens: Passed with intentional product adaptation. Existing VaultMesh visual surfaces replace the reference's pink photographic treatment.
- Image quality and asset fidelity: Passed. The supplied image is used as layout reference; production cards use theme surfaces and library icons rather than raster placeholders.
- Copy and content: Passed. Each item type maps its own protected primary value and two most useful safe metadata fields into the shared layout.
- Responsiveness: Passed by implementation and grid regression coverage. Three columns begin at 1120 px; two columns remain below that breakpoint.
- Interaction and accessibility: Passed. Selection remains persistent; copy/reveal/edit/delete actions remain labelled and appear on hover or focus-within. The browser preview exposed all six cards and final console inspection returned no errors.

## Comparison history

1. Earlier finding — P1: only the payment-card type used the reference structure, so most vault contents appeared unchanged.
2. Fix — applied the shared credit-card hierarchy and aspect ratio to Login, Passkey, payment card, SSH, developer secret, and identity cards; consolidated their controls into the same hover/focus action treatment.
3. Post-fix evidence — `design-qa-implementation.png` shows all six types with the unified structure; `design-qa-comparison.png` confirms the reference hierarchy against the rendered Login and payment-card regions.

## Follow-up polish

- P3: A future pass may localize the English type marks (`LOGIN`, `PASSKEY`, `IDENTITY`) if the product chooses fully Chinese card branding.

final result: passed

---

# Sectioned item editor family QA

- Source visual truth: `/Users/atlan/.codex/state/plugins/product-design/audits/vaultmesh-login-form-2026-08-04/implementation-full-page-v2.jpg`
- Payment card implementation: `/Users/atlan/.codex/state/plugins/product-design/audits/vaultmesh-sectioned-editors-2026-08-04/payment-card-1440x1024.jpg`
- SSH implementation: `/Users/atlan/.codex/state/plugins/product-design/audits/vaultmesh-sectioned-editors-2026-08-04/ssh-credential-1440x1024.jpg`
- Identity implementation: `/Users/atlan/.codex/state/plugins/product-design/audits/vaultmesh-sectioned-editors-2026-08-04/identity-1440x1024.jpg`
- Secret implementation: `/Users/atlan/.codex/state/plugins/product-design/audits/vaultmesh-sectioned-editors-2026-08-04/secret-item-1440x1024.jpg`
- Combined comparison: `/Users/atlan/.codex/state/plugins/product-design/audits/vaultmesh-sectioned-editors-2026-08-04/comparison-all-editors.jpg`
- Source and implementation pixels: 1440 × 1024 each; CSS viewport: 1440 × 1024; device density: 1; no density normalization required.
- Additional responsive checks: 768 × 900 and 480 × 800 CSS px.
- State: unlocked vault, new item, empty renderer-safe preview data, default first section selected.

## Full-view comparison evidence

The payment card, SSH, identity, and developer/service secret editors now match the login editor's viewport-owned composition: compact full-width header, persistent five-item section navigation, broad borderless form workspace, semantic section dividers, and a fixed page-level action bar. All four avoid an enclosing Card and keep the form as the page surface.

## Focused-region comparison evidence

Each 1440 × 1024 page was opened individually before the combined comparison was created. The focused captures confirm consistent heading scale, description rhythm, 17 rem desktop navigation track, form gutters, control height, completion marks, section separators, and footer buttons. At 768 px and 480 px, navigation becomes a horizontally scrollable row, fields collapse without overlap, the footer remains visible, and scrollbar chrome is hidden.

## Findings

- Fonts and typography: Passed. All editors use the same VaultMesh font stack, heading hierarchy, label weight, helper copy scale, wrapping, and antialiasing as the login source.
- Spacing and layout rhythm: Passed. Shared `SectionedEditorForm` owns the navigation track, form padding, section gaps, divider rhythm, and fixed footer. Type-specific field grids remain appropriately dense without reintroducing nested page cards.
- Colors and visual tokens: Passed. Background, muted navigation surface, focus ring, borders, disabled states, and primary actions use the existing semantic theme tokens.
- Image quality and asset fidelity: Passed. These forms contain no raster artwork. Icons use the repository-configured Lucide library and remain consistent with the login source.
- Copy and content: Passed. Type-specific labels and security explanations are preserved and reorganized under clearer sections; no secrets or mock credential values were added.
- Interaction and accessibility: Passed. Section navigation retains `aria-current`, labelled regions, completion labels, native form semantics, labelled icon buttons, Switch controls, and keyboard-focus treatment. Identity address creation was exercised and produced labelled dynamic fields.
- Responsiveness and overflow: Passed. Root `html`/`body` overflow is clipped for every item editor; only the right content region scrolls vertically. Narrow navigation remains scrollable without exposing scrollbar chrome.
- Runtime behavior: Passed by typecheck and 124 renderer tests. Browser console inspection found only the expected outer preview-harness Tauri bootstrap errors caused by running the desktop renderer without a Tauri host; the isolated rendered form tree did not enter an error boundary.

## Comparison history

1. P2 — The first SSH capture stretched the favorite action across the full content width, weakening the shared title/favorite rhythm. Fixed by pairing record type and favorite in the same responsive auto-width grid used by the login source.
2. P2 — The 768 px and 480 px checks exposed browser scrollbar chrome beneath the horizontal section navigation. Fixed by applying the same hidden-chrome treatment to the navigation row while preserving touch, wheel, and keyboard scrolling.
3. Post-fix evidence — refreshed desktop captures and narrow-window screenshots show consistent navigation, form surfaces, footer placement, and no visible outer or navigation scrollbar.

## Follow-up polish

- P3: A later interaction pass can add explicit scroll-position indicators for very narrow windows if user testing shows the hidden horizontal navigation overflow is not discoverable enough.

final result: passed

---

# Login information editor full-page layout QA

- Selected visual direction: `/Users/atlan/.codex/generated_images/019fc9bc-3833-7a72-a132-bd4fc3e5997f/exec-03f2c9a4-9050-4c03-ab1e-2882ef544133.png`
- Implementation screenshot: `/Users/atlan/.codex/state/plugins/product-design/audits/vaultmesh-login-form-2026-08-04/implementation-full-page-v2.jpg`
- Combined comparison: `/Users/atlan/.codex/state/plugins/product-design/audits/vaultmesh-login-form-2026-08-04/comparison-full-page-v2.jpg`
- Browser viewport: 1440 × 1024 CSS px
- State: unlocked vault, new login item, default section selected, empty renderer-safe mock data

## Full-view comparison evidence

The implementation keeps the selected direction's persistent left section navigation, broad right-hand form workspace, restrained monochrome surfaces, compact header, and fixed bottom actions. Following the user's correction, the enclosing card from the generated visual is intentionally removed: the viewport itself now owns the layout.

## Focused layout and scrolling evidence

- The focused login editor shell is exactly one viewport tall and clips root overflow.
- `html` and `body` report `overflow: hidden` while the focused editor is mounted; the app shell is 1440 × 1024 with no visible outer scrollbar.
- The right form region is the sole vertical scroll container (`clientHeight: 894`, `scrollHeight: 1609`, `overflow-y: auto`). Its scrollbar chrome is hidden while wheel, trackpad, keyboard, and navigation-driven scrolling remain available.
- The left navigation and bottom actions remain fixed while the form content moves.

## Interaction evidence

- All five section-navigation buttons are present and uniquely addressable.
- Clicking a section scrolls the right content region and retains the clicked section's active state.
- The inline password “生成” action expands the credential generator and exposes its controls.
- The responsive shell regression helper covers new and existing login editor routes without applying the focused layout to vault or payment-card routes.

## Findings

- Fonts and typography: Passed. Existing VaultMesh tokens preserve a clear heading, label, description, and control hierarchy.
- Spacing and layout rhythm: Passed. The full-page grid removes nested-card padding while keeping generous form gutters and fixed navigation/action zones.
- Colors and surfaces: Passed. Subtle muted backgrounds separate navigation and secondary controls without recreating a card wrapper.
- Content and security behavior: Passed. Existing fields, validation, protected-value behavior, TOTP/recovery-code handling, Passkey handling, and save logic remain intact.
- Responsiveness and overflow: Passed. The outer scrollbar is removed; the right content pane is the only scrollable region.
- Interaction and accessibility: Passed. Semantic navigation, regions, `aria-current`, labelled icon actions, Switch controls, and visible focus treatment are retained.

## Comparison history

1. P1 — The initial implementation kept the form inside a centered card. Fixed by making the entire page a two-column workspace with page-level actions.
2. P1 — A visible outer scrollbar made the editor look like a page nested inside another page. Fixed with a viewport-owned flex shell, route-scoped root overflow clipping, and a single hidden-chrome content scroller.
3. P2 — Smooth section navigation could hand the active state back to a nearby section near the end of the form. Fixed by keeping the selected state during programmatic scrolling and scrolling relative to the content pane's padding.
4. Post-fix evidence — the 1440 × 1024 screenshot and combined comparison show a full-page editor with no enclosing card and no visible outer scrollbar.

final result: passed
