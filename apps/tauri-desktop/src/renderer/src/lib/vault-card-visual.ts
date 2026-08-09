import { paymentCardVisualIndex } from './payment-card';

export const VAULT_CARD_VISUALS = [
  {
    name: 'indigo-prism',
    surface: 'border-indigo-300/25 bg-[linear-gradient(135deg,oklch(0.42_0.20_266),oklch(0.25_0.13_270)_58%,oklch(0.36_0.18_291))]',
    pattern: 'bg-[radial-gradient(circle_at_84%_14%,rgb(255_255_255_/_0.24),transparent_24%),linear-gradient(115deg,transparent_32%,rgb(255_255_255_/_0.07)_49%,transparent_66%)]',
  },
  {
    name: 'emerald-flow',
    surface: 'border-emerald-300/25 bg-[linear-gradient(140deg,oklch(0.42_0.13_162),oklch(0.23_0.07_174)_60%,oklch(0.31_0.10_205))]',
    pattern: 'bg-[radial-gradient(ellipse_at_12%_110%,rgb(110_231_183_/_0.35),transparent_45%),radial-gradient(circle_at_90%_8%,rgb(255_255_255_/_0.20),transparent_22%)]',
  },
  {
    name: 'copper-sunset',
    surface: 'border-orange-200/25 bg-[linear-gradient(135deg,oklch(0.50_0.18_35),oklch(0.30_0.12_17)_58%,oklch(0.36_0.15_315))]',
    pattern: 'bg-[linear-gradient(120deg,transparent_18%,rgb(251_191_36_/_0.16)_42%,transparent_64%),radial-gradient(circle_at_86%_16%,rgb(255_255_255_/_0.20),transparent_22%)]',
  },
  {
    name: 'graphite-grid',
    surface: 'border-slate-300/25 bg-[linear-gradient(145deg,oklch(0.30_0.025_255),oklch(0.15_0.015_260)_62%,oklch(0.24_0.035_235))]',
    pattern: 'bg-[repeating-linear-gradient(125deg,transparent_0,transparent_16px,rgb(255_255_255_/_0.035)_17px,rgb(255_255_255_/_0.035)_18px),radial-gradient(circle_at_88%_12%,rgb(148_163_184_/_0.28),transparent_25%)]',
  },
  {
    name: 'sapphire-wave',
    surface: 'border-sky-200/25 bg-[linear-gradient(135deg,oklch(0.43_0.18_245),oklch(0.24_0.10_252)_58%,oklch(0.32_0.15_225))]',
    pattern: 'bg-[radial-gradient(ellipse_at_15%_115%,rgb(125_211_252_/_0.38),transparent_46%),linear-gradient(105deg,transparent_46%,rgb(255_255_255_/_0.10)_47%,transparent_60%)]',
  },
  {
    name: 'plum-aurora',
    surface: 'border-fuchsia-200/25 bg-[linear-gradient(140deg,oklch(0.40_0.16_320),oklch(0.23_0.09_305)_56%,oklch(0.38_0.12_55))]',
    pattern: 'bg-[radial-gradient(ellipse_at_100%_0%,rgb(253_224_71_/_0.23),transparent_34%),radial-gradient(ellipse_at_0%_100%,rgb(232_121_249_/_0.24),transparent_42%)]',
  },
] as const;

export function vaultCardVisualFor(itemId: string, offset = 0): (typeof VAULT_CARD_VISUALS)[number] {
  const visualIndex = (paymentCardVisualIndex(itemId, VAULT_CARD_VISUALS.length) + offset) % VAULT_CARD_VISUALS.length;
  return VAULT_CARD_VISUALS[visualIndex]!;
}
