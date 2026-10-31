import type { Locale } from "./config";

const ar = {
  brand: "شروق",
  brandEn: "SHROUK",
  tagline: "نظرة جديدة لكل يوم مشرق",
  skipToContent: "تخطي إلى المحتوى",
  nav: {
    sunglasses: "النظارات الشمسية",
    prescription: "النظارات الطبية",
    lenses: "العدسات اللاصقة",
    kids: "نظارات الأطفال",
    about: "من نحن",
    blog: "المدونة",
    branches: "الفروع",
    contact: "تواصل معنا",
  },
  actions: { language: "English", theme: "المظهر" },
  theme: { light: "فاتح", dark: "داكن", system: "حسب الجهاز" },
  footer: { rights: "جميع الحقوق محفوظة" },
  home: {
    title: "شروق | نظارات لكل يوم مشرق",
    foundationTitle: "الأساس جاهز",
    foundationBody: "هذه صفحة تحقق للمرحلة الأولى. تصميم الصفحات الفعلية يبدأ في المرحلة الثانية.",
    demoLabel: "نموذج تجريبي",
  },
  notFound: { title: "الصفحة غير موجودة", body: "الرابط الذي طلبته غير متاح.", back: "العودة للرئيسية" },
};

export type Dictionary = typeof ar;

const en: Dictionary = {
  brand: "شروق",
  brandEn: "SHROUK",
  tagline: "A brighter view, every day",
  skipToContent: "Skip to content",
  nav: {
    sunglasses: "Sunglasses",
    prescription: "Prescription",
    lenses: "Contact lenses",
    kids: "Kids",
    about: "About",
    blog: "Blog",
    branches: "Branches",
    contact: "Contact",
  },
  actions: { language: "العربية", theme: "Theme" },
  theme: { light: "Light", dark: "Dark", system: "System" },
  footer: { rights: "All rights reserved" },
  home: {
    title: "SHROUK | Eyewear for a brighter day",
    foundationTitle: "Foundation ready",
    foundationBody: "This is a Phase 1 verification page. The real page designs start in Phase 2.",
    demoLabel: "Demo content",
  },
  notFound: {
    title: "Page not found",
    body: "The page you asked for is not available.",
    back: "Back to home",
  },
};

export const dictionaries: Record<Locale, Dictionary> = { ar, en };
