import { createContext, useContext } from "react";
import type { Locale } from "./config";
import { dictionaries, type Dictionary } from "./dictionary";
import { pages, type PagesDict } from "./pages";
import { adminDict, type AdminDict } from "./admin";

type Ctx = { lang: Locale; t: Dictionary; p: PagesDict; a: AdminDict };
const LocaleContext = createContext<Ctx | null>(null);

export function LocaleProvider({ lang, children }: { lang: Locale; children: React.ReactNode }) {
  return (
    <LocaleContext.Provider value={{ lang, t: dictionaries[lang], p: pages[lang], a: adminDict[lang] }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useT(): Ctx {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useT must be used inside LocaleProvider");
  return ctx;
}
