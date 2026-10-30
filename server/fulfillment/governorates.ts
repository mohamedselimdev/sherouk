/** Egypt's 27 governorates. Keys are stable identifiers; names are for display. */
export const GOVERNORATES = [
  { key: "cairo", ar: "القاهرة", en: "Cairo" },
  { key: "giza", ar: "الجيزة", en: "Giza" },
  { key: "alexandria", ar: "الإسكندرية", en: "Alexandria" },
  { key: "qalyubia", ar: "القليوبية", en: "Qalyubia" },
  { key: "port-said", ar: "بورسعيد", en: "Port Said" },
  { key: "suez", ar: "السويس", en: "Suez" },
  { key: "dakahlia", ar: "الدقهلية", en: "Dakahlia" },
  { key: "sharqia", ar: "الشرقية", en: "Sharqia" },
  { key: "gharbia", ar: "الغربية", en: "Gharbia" },
  { key: "monufia", ar: "المنوفية", en: "Monufia" },
  { key: "beheira", ar: "البحيرة", en: "Beheira" },
  { key: "kafr-el-sheikh", ar: "كفر الشيخ", en: "Kafr El Sheikh" },
  { key: "damietta", ar: "دمياط", en: "Damietta" },
  { key: "ismailia", ar: "الإسماعيلية", en: "Ismailia" },
  { key: "fayoum", ar: "الفيوم", en: "Fayoum" },
  { key: "beni-suef", ar: "بني سويف", en: "Beni Suef" },
  { key: "minya", ar: "المنيا", en: "Minya" },
  { key: "asyut", ar: "أسيوط", en: "Asyut" },
  { key: "sohag", ar: "سوهاج", en: "Sohag" },
  { key: "qena", ar: "قنا", en: "Qena" },
  { key: "luxor", ar: "الأقصر", en: "Luxor" },
  { key: "aswan", ar: "أسوان", en: "Aswan" },
  { key: "red-sea", ar: "البحر الأحمر", en: "Red Sea" },
  { key: "new-valley", ar: "الوادي الجديد", en: "New Valley" },
  { key: "matrouh", ar: "مطروح", en: "Matrouh" },
  { key: "north-sinai", ar: "شمال سيناء", en: "North Sinai" },
  { key: "south-sinai", ar: "جنوب سيناء", en: "South Sinai" },
] as const;

export type GovernorateKey = (typeof GOVERNORATES)[number]["key"];
export const GOVERNORATE_KEYS = GOVERNORATES.map((g) => g.key) as GovernorateKey[];
