/**
 * DEMO DATA — placeholder branches and blog posts, plus colour display names.
 * Branches and blog move to the database/CMS in later phases; the product catalog already lives in PostgreSQL.
 * None of these names, prices, branches or articles are real business information.
 */
import type { Locale } from "~/i18n/config";

export type L10n = Record<Locale, string>;

export const COLORS = {
  black: { hex: "#171514", name: { ar: "أسود", en: "Black" } },
  brown: { hex: "#6b3f2a", name: { ar: "بني", en: "Brown" } },
  tortoise: { hex: "#8a4b22", name: { ar: "بني تورتواز", en: "Tortoise" } },
  olive: { hex: "#4b5a3a", name: { ar: "زيتي", en: "Olive" } },
  amber: { hex: "#d98a2b", name: { ar: "عنبري", en: "Amber" } },
  rose: { hex: "#d9a7a0", name: { ar: "وردي", en: "Rose" } },
  gold: { hex: "#c9a24a", name: { ar: "ذهبي", en: "Gold" } },
  silver: { hex: "#a9adb2", name: { ar: "فضي", en: "Silver" } },
  clear: { hex: "#e8e1da", name: { ar: "شفاف", en: "Clear" } },
  orange: { hex: "#e5641c", name: { ar: "برتقالي", en: "Orange" } },
} as const;
export type ColorKey = keyof typeof COLORS;

export function colorName(key: string, lang: Locale): string {
  return (COLORS as Record<string, { name: L10n }>)[key]?.name[lang] ?? key;
}
export function colorHex(key: string): string {
  return (COLORS as Record<string, { hex: string }>)[key]?.hex ?? "#999999";
}

export type DemoBranch = {
  slug: string;
  name: L10n;
  city: L10n;
  address: L10n;
  phone: string;
  hours: L10n;
  image: string;
  main?: boolean;
  /** Search query for the directions link; real coordinates arrive with verified branch data. */
  mapQuery: string;
};

export const BRANCHES: DemoBranch[] = [
  {
    slug: "demo-zamalek",
    name: { ar: "فرع الزمالك (تجريبي)", en: "Zamalek branch (demo)" },
    city: { ar: "القاهرة", en: "Cairo" },
    address: { ar: "عنوان تجريبي — الزمالك، القاهرة", en: "Demo address — Zamalek, Cairo" },
    phone: "+20 10 0000 0001",
    hours: { ar: "10:00 ص إلى 11:00 م", en: "10:00 AM – 11:00 PM" },
    image: "/assets/lifestyle/portrait-man-editorial.webp",
    main: true,
    mapQuery: "Zamalek Cairo",
  },
  {
    slug: "demo-nasr-city",
    name: { ar: "فرع مدينة نصر (تجريبي)", en: "Nasr City branch (demo)" },
    city: { ar: "القاهرة", en: "Cairo" },
    address: { ar: "عنوان تجريبي — مدينة نصر، القاهرة", en: "Demo address — Nasr City, Cairo" },
    phone: "+20 10 0000 0002",
    hours: { ar: "10:00 ص إلى 11:00 م", en: "10:00 AM – 11:00 PM" },
    image: "/assets/lifestyle/portrait-woman-frames.webp",
    mapQuery: "Nasr City Cairo",
  },
  {
    slug: "demo-alexandria",
    name: { ar: "فرع الإسكندرية (تجريبي)", en: "Alexandria branch (demo)" },
    city: { ar: "الإسكندرية", en: "Alexandria" },
    address: { ar: "عنوان تجريبي — الإسكندرية", en: "Demo address — Alexandria" },
    phone: "+20 10 0000 0003",
    hours: { ar: "10:00 ص إلى 10:00 م", en: "10:00 AM – 10:00 PM" },
    image: "/assets/lifestyle/portrait-woman-sunglasses.webp",
    mapQuery: "Alexandria Egypt",
  },
  {
    slug: "demo-mansoura",
    name: { ar: "فرع المنصورة (تجريبي)", en: "Mansoura branch (demo)" },
    city: { ar: "المنصورة", en: "Mansoura" },
    address: { ar: "عنوان تجريبي — المنصورة", en: "Demo address — Mansoura" },
    phone: "+20 10 0000 0004",
    hours: { ar: "10:00 ص إلى 10:00 م", en: "10:00 AM – 10:00 PM" },
    image: "/assets/lifestyle/portrait-child-frames.webp",
    mapQuery: "Mansoura Egypt",
  },
];

export type DemoPost = {
  slug: string;
  category: "eye-care" | "fashion" | "guide" | "lifestyle" | "lenses";
  title: L10n;
  excerpt: L10n;
  image: string;
};

export const POST_CATEGORIES: { key: DemoPost["category"]; name: L10n }[] = [
  { key: "lifestyle", name: { ar: "أسلوب الحياة", en: "Lifestyle" } },
  { key: "lenses", name: { ar: "العدسات اللاصقة", en: "Contact lenses" } },
  { key: "fashion", name: { ar: "الموضة والإطلالات", en: "Fashion & looks" } },
  { key: "guide", name: { ar: "دليل الاختيار", en: "Buying guide" } },
  { key: "eye-care", name: { ar: "نصائح العناية بالعينين", en: "Eye-care tips" } },
];

export const POSTS: DemoPost[] = [
  {
    slug: "choose-frames-for-face-shape",
    category: "guide",
    title: { ar: "كيف تختارين النظارة المناسبة لشكل وجهك؟", en: "How to choose frames for your face shape" },
    excerpt: {
      ar: "دليل يساعدك على معرفة شكل وجهك وأفضل الإطارات التي تبرز ملامحك.",
      en: "A guide to your face shape and the frames that flatter it.",
    },
    image: "/assets/hero/hero-desktop-text-free.webp",
  },
  {
    slug: "contact-lens-basics",
    category: "lenses",
    title: { ar: "كل ما تحتاجين معرفته عن العدسات اللاصقة", en: "Contact lens basics" },
    excerpt: {
      ar: "مقدمة عامة للاستخدام والعناية. استشيري طبيب العيون قبل الاستخدام.",
      en: "A general intro to use and care. Consult an eye doctor first.",
    },
    image: "/assets/lifestyle/closeup-eye.webp",
  },
  {
    slug: "sunglasses-trends",
    category: "fashion",
    title: { ar: "أبرز صيحات النظارات الشمسية", en: "Sunglasses trends to watch" },
    excerpt: {
      ar: "نظرة على الأشكال والألوان الرائجة هذا الموسم.",
      en: "A look at the shapes and colours trending this season.",
    },
    image: "/assets/products/photographic-previews/tortoise-sunglasses-crop.webp",
  },
  {
    slug: "daily-eye-care",
    category: "eye-care",
    title: { ar: "نصائح يومية للحفاظ على صحة عينيك", en: "Daily habits for comfortable eyes" },
    excerpt: {
      ar: "عادات بسيطة تخفف إجهاد العين أمام الشاشات.",
      en: "Simple habits that ease screen-related eye strain.",
    },
    image: "/assets/backgrounds/leaf-shadow-wall.webp",
  },
  {
    slug: "sun-protection",
    category: "eye-care",
    title: { ar: "دور النظارات الشمسية في حماية العينين", en: "How sunglasses help protect your eyes" },
    excerpt: {
      ar: "لماذا تعد حماية العينين من الأشعة فوق البنفسجية مهمة.",
      en: "Why UV protection matters for your eyes.",
    },
    image: "/assets/lifestyle/portrait-man-sunglasses.webp",
  },
];

export const postBySlug = (slug: string | undefined) => POSTS.find((p) => p.slug === slug);
