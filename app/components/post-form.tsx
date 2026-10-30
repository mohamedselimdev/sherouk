import { useT } from "~/i18n/context";
import { inputCls } from "~/components/form";
import { POST_CATEGORIES } from "~/demo/data";
import type { posts } from "../../db/schema";

type Values = Partial<typeof posts.$inferSelect>;

/** Shared fields for creating and editing a bilingual post. */
export function PostFields({ values = {} }: { values?: Values }) {
  const { a, lang } = useT();
  const m = a.modules;
  const field = (
    name: string,
    label: string,
    def: string | null | undefined,
    opts: { dir?: "rtl" | "ltr"; area?: boolean; max?: number } = {},
  ) => (
    <label className="grid gap-1 text-sm">
      {label}
      {opts.area ? (
        <textarea
          name={name}
          required
          rows={8}
          maxLength={opts.max}
          dir={opts.dir}
          defaultValue={def ?? ""}
          className={inputCls}
        />
      ) : (
        <input
          name={name}
          required
          maxLength={opts.max}
          dir={opts.dir}
          defaultValue={def ?? ""}
          className={inputCls}
        />
      )}
    </label>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <fieldset className="grid content-start gap-3">
        <legend className="mb-1 font-semibold">{m.arabicVersion}</legend>
        {field("titleAr", m.postTitle, values.titleAr, { dir: "rtl", max: 160 })}
        {field("slugAr", m.postSlug, values.slugAr, { dir: "rtl", max: 80 })}
        {field("excerptAr", m.postExcerpt, values.excerptAr, { dir: "rtl", max: 300 })}
        {field("bodyAr", m.postBody, values.bodyAr, { dir: "rtl", area: true, max: 20000 })}
      </fieldset>
      <fieldset className="grid content-start gap-3">
        <legend className="mb-1 font-semibold">{m.englishVersion}</legend>
        {field("titleEn", m.postTitle, values.titleEn, { dir: "ltr", max: 160 })}
        {field("slugEn", m.postSlug, values.slugEn, { dir: "ltr", max: 80 })}
        {field("excerptEn", m.postExcerpt, values.excerptEn, { dir: "ltr", max: 300 })}
        {field("bodyEn", m.postBody, values.bodyEn, { dir: "ltr", area: true, max: 20000 })}
      </fieldset>
      <label className="grid gap-1 text-sm">
        {m.postCategory}
        <select name="category" defaultValue={values.category ?? "guide"} className={inputCls}>
          {POST_CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name[lang]}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        {m.postCover}
        <input
          name="coverImage"
          dir="ltr"
          placeholder="/assets/hero/..."
          maxLength={300}
          defaultValue={values.coverImage ?? ""}
          className={inputCls}
        />
      </label>
    </div>
  );
}
