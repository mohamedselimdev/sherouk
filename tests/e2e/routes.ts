/** Every storefront and admin route implemented so far (locale-less path). */
export const ROUTES = [
  "",
  "/shop",
  "/c/sunglasses",
  "/c/lenses",
  "/p/classic-sunglasses",
  "/cart",
  "/checkout",
  "/branches",
  "/about",
  "/blog",
  "/blog/daily-eye-care",
  "/account/login",
  "/account/register",
] as const;

export const VIEWPORTS = [360, 390, 430, 768, 1024, 1280, 1440, 1920] as const;
export const LOCALES = ["ar", "en"] as const;
