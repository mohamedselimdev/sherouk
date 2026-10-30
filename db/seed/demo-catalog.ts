/**
 * DEMO catalog for development and design review. Names, prices and artwork are placeholders, not real stock.
 * Product images are the kit's vector illustrations served from /public/assets (`static:` media keys).
 */
export const DEMO_CATEGORIES = [
  {
    key: "sunglasses",
    sortOrder: 1,
    ar: { name: "النظارات الشمسية", blurb: "للاطلالات المبهرة" },
    en: { name: "Sunglasses", blurb: "For standout looks" },
  },
  {
    key: "prescription",
    sortOrder: 2,
    ar: { name: "النظارات الطبية", blurb: "رؤية أوضح وأناقة أفضل" },
    en: { name: "Prescription frames", blurb: "Sharper sight, better style" },
  },
  {
    key: "lenses",
    sortOrder: 3,
    ar: { name: "العدسات اللاصقة", blurb: "راحة ووضوح طوال اليوم" },
    en: { name: "Contact lenses", blurb: "Comfort and clarity all day" },
  },
  {
    key: "kids",
    sortOrder: 4,
    ar: { name: "نظارات الأطفال", blurb: "حماية لعيونهم بأناقة" },
    en: { name: "Kids eyewear", blurb: "Stylish protection for little eyes" },
  },
] as const;

type DemoProduct = {
  slug: string;
  category: string;
  shape: "round" | "square" | "aviator" | "cat-eye" | "sport";
  /** EGP, whole pounds; converted to piasters on insert. */
  price: number;
  oldPrice?: number;
  featured?: boolean;
  image: string;
  colors: string[];
  ar: { name: string; sub: string };
  en: { name: string; sub: string };
};

const art = (n: string) => `static:/assets/products/vector-illustrations/${n}.webp`;

export const DEMO_PRODUCTS: DemoProduct[] = [
  {
    slug: "classic-sunglasses",
    category: "sunglasses",
    shape: "square",
    price: 2450,
    featured: true,
    image: art("wayfarer-black"),
    colors: ["black", "brown", "olive"],
    ar: { name: "نظارة شمسية كلاسيك", sub: "إطار أسود عصري" },
    en: { name: "Classic sunglasses", sub: "Modern black frame" },
  },
  {
    slug: "round-sunglasses",
    category: "sunglasses",
    shape: "round",
    price: 2250,
    oldPrice: 2900,
    image: art("round-amber"),
    colors: ["amber", "brown", "gold"],
    ar: { name: "نظارة شمسية دائرية", sub: "عدسات متدرجة" },
    en: { name: "Round sunglasses", sub: "Gradient lenses" },
  },
  {
    slug: "aviator-sunglasses",
    category: "sunglasses",
    shape: "aviator",
    price: 2100,
    image: art("aviator-gold"),
    colors: ["gold", "olive", "black"],
    ar: { name: "نظارة شمسية أفياتور", sub: "إطار معدني ذهبي" },
    en: { name: "Aviator sunglasses", sub: "Gold metal frame" },
  },
  {
    slug: "modern-optical",
    category: "prescription",
    shape: "round",
    price: 1950,
    image: art("round-rose"),
    colors: ["rose", "brown", "clear"],
    ar: { name: "نظارة طبية عصرية", sub: "وردي شفاف، إطار خفيف" },
    en: { name: "Modern optical frame", sub: "Translucent rose, light frame" },
  },
  {
    slug: "cat-eye-sunglasses",
    category: "sunglasses",
    shape: "cat-eye",
    price: 2600,
    image: art("cat-eye-copper"),
    colors: ["brown", "gold", "black"],
    ar: { name: "نظارة شمسية كات آي", sub: "نحاسي أنيق" },
    en: { name: "Cat-eye sunglasses", sub: "Elegant copper tone" },
  },
  {
    slug: "tortoise-sunglasses",
    category: "sunglasses",
    shape: "square",
    price: 2750,
    image: art("wayfarer-tortoise"),
    colors: ["tortoise", "black", "olive"],
    ar: { name: "نظارة شمسية تورتواز", sub: "إطار بني مميز" },
    en: { name: "Tortoise sunglasses", sub: "Signature brown frame" },
  },
  {
    slug: "clear-rectangle-optical",
    category: "prescription",
    shape: "square",
    price: 1850,
    image: art("rectangle-clear"),
    colors: ["clear", "black"],
    ar: { name: "نظارة طبية مستطيلة", sub: "إطار شفاف خفيف" },
    en: { name: "Rectangle optical frame", sub: "Light clear frame" },
  },
  {
    slug: "silver-aviator",
    category: "sunglasses",
    shape: "aviator",
    price: 2300,
    oldPrice: 2800,
    image: art("aviator-silver"),
    colors: ["silver", "black"],
    ar: { name: "نظارة أفياتور فضية", sub: "عدسات مقاومة للانعكاس" },
    en: { name: "Silver aviator", sub: "Anti-glare lenses" },
  },
  {
    slug: "sport-sunglasses",
    category: "sunglasses",
    shape: "sport",
    price: 2100,
    image: art("sport-black"),
    colors: ["black", "olive"],
    ar: { name: "نظارة شمسية رياضية", sub: "ثبات للحركة" },
    en: { name: "Sport sunglasses", sub: "Secure fit for movement" },
  },
  {
    slug: "kids-frames",
    category: "kids",
    shape: "round",
    price: 1450,
    image: art("kids-orange"),
    colors: ["orange", "black"],
    ar: { name: "نظارة أطفال ملونة", sub: "مرنة وخفيفة" },
    en: { name: "Colourful kids frames", sub: "Flexible and light" },
  },
];

export const DEMO_BRANCHES = [
  {
    slug: "demo-zamalek",
    phone: "+20 10 0000 0001",
    ar: { name: "فرع الزمالك (تجريبي)", city: "القاهرة", address: "عنوان تجريبي — الزمالك، القاهرة" },
    en: { name: "Zamalek branch (demo)", city: "Cairo", address: "Demo address — Zamalek, Cairo" },
  },
  {
    slug: "demo-nasr-city",
    phone: "+20 10 0000 0002",
    ar: { name: "فرع مدينة نصر (تجريبي)", city: "القاهرة", address: "عنوان تجريبي — مدينة نصر، القاهرة" },
    en: { name: "Nasr City branch (demo)", city: "Cairo", address: "Demo address — Nasr City, Cairo" },
  },
] as const;
