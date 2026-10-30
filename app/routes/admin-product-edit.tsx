import { data, Form, Link, redirect, useActionData, useOutletContext } from "react-router";
import { ZodError } from "zod";
import type { Route } from "./+types/admin-product-edit";
import type { AdminOutletContext } from "~/layouts/admin";
import { colorName } from "~/demo/data";
import { useT } from "~/i18n/context";
import { formatEGP } from "~/lib/format";
import { Field, FormError, FormOk, inputCls, SubmitButton } from "~/components/form";
import { btnOutline, btnPrimary } from "~/components/ui";
import { ForbiddenError } from "../../server/auth/rbac";
import {
  addVariant,
  archiveVariant,
  attachMedia,
  ConflictError,
  createProduct,
  getAdminProduct,
  NotFoundError,
  removeMedia,
  setProductStatus,
  updateProduct,
  updateVariant,
  ValidationFailure,
} from "../../server/catalog/admin";
import { COLOR_KEYS, FRAME_SHAPES } from "../../server/catalog/schemas";
import { listStoreCategories } from "../../server/catalog/store";
import { prepareImageUpload, UploadRejected } from "../../server/catalog/upload";
import { mediaUrl } from "../../server/catalog/store";
import { requireStaff, requireStaffAction } from "../../server/http/session";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { principal, scope } = await requireStaff(request, context, {
    lang: params.lang,
    permission: "catalog:read",
  });
  const categories = await listStoreCategories(scope.db, params.lang === "en" ? "en" : "ar");
  if (params.id === "new") return { product: null, categories };
  try {
    const product = await getAdminProduct(scope.db, principal, params.id);
    return {
      product: { ...product, images: product.images.map((m) => ({ id: m.id, url: mediaUrl(m.r2Key) })) },
      categories,
    };
  } catch (e) {
    if (e instanceof NotFoundError) throw data(null, { status: 404 });
    throw e;
  }
}

const text = (f: FormData, k: string) => (f.get(k)?.toString() ?? "").trim();

/** "2450" or "2450.50" EGP -> integer piasters. Anything else is rejected rather than guessed. */
function toPiasters(value: string): number | null {
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(value)) return null;
  return Math.round(Number(value) * 100);
}

function productFromForm(f: FormData) {
  const tr = (l: "ar" | "en") => ({
    name: text(f, `${l}_name`),
    subtitle: text(f, `${l}_subtitle`),
    description: text(f, `${l}_description`),
    slug: text(f, `${l}_slug`),
  });
  return {
    categoryKey: text(f, "categoryKey"),
    brandKey: null,
    frameShape: text(f, "frameShape") || null,
    featured: f.get("featured") === "on",
    ar: tr("ar"),
    en: tr("en"),
  };
}

function variantFromForm(f: FormData) {
  const price = toPiasters(text(f, "price"));
  const compare = text(f, "compareAt");
  return {
    sku: text(f, "sku"),
    colorKey: text(f, "colorKey"),
    pricePiasters: price ?? Number.NaN,
    compareAtPiasters: compare ? (toPiasters(compare) ?? Number.NaN) : null,
    sortOrder: Number(text(f, "sortOrder") || 0),
  };
}

type Result =
  { ok: string } | { error: "invalidInput" | "conflict" | "needVariant" | "forbidden" | "badImage" };

export async function action({ request, context, params }: Route.ActionArgs): Promise<Result | Response> {
  const { auth, form } = await requireStaffAction(request, context, { lang: params.lang });
  const { scope, principal } = auth;
  const db = scope.db;
  const intent = text(form, "intent");
  try {
    switch (intent) {
      case "save": {
        if (params.id === "new") {
          const { id } = await createProduct(db, principal, productFromForm(form));
          return redirect(`/${params.lang}/admin/products/${id}`);
        }
        await updateProduct(db, principal, params.id, productFromForm(form));
        return { ok: "saved" };
      }
      case "status": {
        const status = text(form, "status");
        if (status !== "draft" && status !== "published" && status !== "archived")
          return { error: "invalidInput" };
        await setProductStatus(db, principal, params.id, status);
        return { ok: "saved" };
      }
      case "variant-add":
        await addVariant(db, principal, params.id, variantFromForm(form));
        return { ok: "saved" };
      case "variant-update":
        await updateVariant(db, principal, text(form, "variantId"), variantFromForm(form));
        return { ok: "saved" };
      case "variant-archive":
        await archiveVariant(db, principal, text(form, "variantId"));
        return { ok: "saved" };
      case "media-upload": {
        const upload = await prepareImageUpload(form.get("file"));
        await scope.env.MEDIA.put(upload.key, upload.body, {
          httpMetadata: { contentType: upload.contentType },
        });
        try {
          await attachMedia(db, principal, params.id, {
            r2Key: upload.key,
            contentType: upload.contentType,
            bytes: upload.body.byteLength,
            altAr: text(form, "altAr") || undefined,
            altEn: text(form, "altEn") || undefined,
          });
        } catch (e) {
          await scope.env.MEDIA.delete(upload.key);
          throw e;
        }
        return { ok: "saved" };
      }
      case "media-delete": {
        const key = await removeMedia(db, principal, text(form, "mediaId"));
        if (!key.startsWith("static:")) await scope.env.MEDIA.delete(key);
        return { ok: "saved" };
      }
      default:
        return { error: "invalidInput" };
    }
  } catch (e) {
    if (e instanceof ZodError) return { error: "invalidInput" };
    if (e instanceof ConflictError) return { error: "conflict" };
    if (e instanceof ForbiddenError) return { error: "forbidden" };
    if (e instanceof UploadRejected) return { error: "badImage" };
    if (e instanceof ValidationFailure)
      return { error: /variant/i.test(e.message) ? "needVariant" : "invalidInput" };
    if (e instanceof NotFoundError) throw data(null, { status: 404 });
    throw e;
  }
}

const hidden = (csrf: string, intent: string) => (
  <>
    <input type="hidden" name="_csrf" value={csrf} />
    <input type="hidden" name="intent" value={intent} />
  </>
);

export default function AdminProductEdit({ loaderData }: Route.ComponentProps) {
  const { a, lang } = useT();
  const { csrf, caps } = useOutletContext<AdminOutletContext>();
  const result = useActionData<typeof action>();
  const { product, categories } = loaderData;
  const tr = (l: "ar" | "en") => product?.translations.find((t) => t.locale === l);
  const message =
    result && "error" in result
      ? (a.products as unknown as Record<string, string>)[
          result.error === "invalidInput" ? "invalidInput" : result.error
        ]
      : null;
  const readOnly = !caps.catalogWrite;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          {product ? (lang === "ar" ? tr("ar")?.name : tr("en")?.name) : a.products.new}
        </h1>
        <Link to={`/${lang}/admin/products`} className={btnOutline}>
          {a.products.title}
        </Link>
      </div>
      <FormError>{message}</FormError>
      <FormOk>{result && "ok" in result ? a.products.saved : null}</FormOk>

      <Form
        method="post"
        className="grid gap-4 rounded-card border border-sand bg-surface p-5 md:grid-cols-2"
      >
        {hidden(csrf, "save")}
        <fieldset disabled={readOnly} className="contents">
          <Field label={a.products.nameAr} name="ar_name" defaultValue={tr("ar")?.name} />
          <Field label={a.products.nameEn} name="en_name" defaultValue={tr("en")?.name} dir="ltr" />
          <Field label={a.products.slugAr} name="ar_slug" defaultValue={tr("ar")?.slug} dir="ltr" />
          <Field label={a.products.slugEn} name="en_slug" defaultValue={tr("en")?.slug} dir="ltr" />
          <Field
            label={a.products.subtitle}
            name="ar_subtitle"
            defaultValue={tr("ar")?.subtitle ?? ""}
            required={false}
          />
          <Field
            label={`${a.products.subtitle} (EN)`}
            name="en_subtitle"
            defaultValue={tr("en")?.subtitle ?? ""}
            required={false}
            dir="ltr"
          />
          <label className="block text-sm font-medium">
            {a.products.description}
            <textarea
              name="ar_description"
              rows={4}
              defaultValue={tr("ar")?.description ?? ""}
              className={inputCls}
            />
          </label>
          <label className="block text-sm font-medium">
            {a.products.description} (EN)
            <textarea
              name="en_description"
              rows={4}
              dir="ltr"
              defaultValue={tr("en")?.description ?? ""}
              className={inputCls}
            />
          </label>
          <label className="block text-sm font-medium">
            {a.products.category}
            <select
              name="categoryKey"
              required
              defaultValue={product?.categoryKey ?? categories[0]?.key}
              className={inputCls}
            >
              {categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            {a.products.shape}
            <select name="frameShape" defaultValue={product?.frameShape ?? ""} className={inputCls}>
              <option value="">{a.products.noShape}</option>
              {FRAME_SHAPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              name="featured"
              defaultChecked={product?.featured}
              className="size-4 accent-[var(--cta)]"
            />
            {a.products.featured}
          </label>
          {!readOnly ? (
            <div className="md:col-span-2">
              <SubmitButton>{a.products.save}</SubmitButton>
            </div>
          ) : null}
        </fieldset>
      </Form>

      {!product ? (
        <p className="text-sm text-muted">{a.products.createdHint}</p>
      ) : (
        <>
          <section className="flex flex-wrap items-center gap-3 rounded-card border border-sand bg-surface p-5">
            <p className="text-sm">
              {a.products.status}: <strong>{a.products.statuses[product.status]}</strong>
            </p>
            {(["published", "draft", "archived"] as const)
              .filter((s) => s !== product.status)
              .map((s) => (
                <Form method="post" key={s}>
                  {hidden(csrf, "status")}
                  <input type="hidden" name="status" value={s} />
                  <button type="submit" className={s === "published" ? btnPrimary : btnOutline}>
                    {s === "published"
                      ? a.products.publish
                      : s === "draft"
                        ? a.products.unpublish
                        : a.products.archive}
                  </button>
                </Form>
              ))}
          </section>

          <section
            className="space-y-3 rounded-card border border-sand bg-surface p-5"
            aria-labelledby="variants-h"
          >
            <h2 id="variants-h" className="text-lg font-bold">
              {a.products.variantsTitle}
            </h2>
            <ul className="grid gap-3">
              {product.variants
                .filter((v) => !v.archivedAt)
                .map((v) => (
                  <li key={v.id} className="rounded-input border border-sand p-3">
                    <Form
                      method="post"
                      className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end"
                    >
                      {hidden(csrf, "variant-update")}
                      <input type="hidden" name="variantId" value={v.id} />
                      <input type="hidden" name="sortOrder" value={v.sortOrder} />
                      <Field label={a.products.sku} name="sku" defaultValue={v.sku} dir="ltr" />
                      <label className="block text-sm font-medium">
                        {a.products.color}
                        <select name="colorKey" defaultValue={v.colorKey} className={inputCls}>
                          {COLOR_KEYS.map((c) => (
                            <option key={c} value={c}>
                              {colorName(c, lang)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Field
                        label={a.products.priceEgp}
                        name="price"
                        defaultValue={(v.pricePiasters / 100).toFixed(2)}
                        inputMode="decimal"
                        dir="ltr"
                      />
                      <Field
                        label={a.products.compareAt}
                        name="compareAt"
                        defaultValue={v.compareAtPiasters ? (v.compareAtPiasters / 100).toFixed(2) : ""}
                        required={false}
                        inputMode="decimal"
                        dir="ltr"
                      />
                      <SubmitButton>{a.products.save}</SubmitButton>
                    </Form>
                    <Form method="post" className="mt-2 flex items-center gap-3 text-sm">
                      {hidden(csrf, "variant-archive")}
                      <input type="hidden" name="variantId" value={v.id} />
                      <span className="text-muted">{formatEGP(v.pricePiasters, lang)}</span>
                      <button type="submit" className="text-cta underline">
                        {a.products.archiveVariant}
                      </button>
                    </Form>
                  </li>
                ))}
            </ul>
            <Form
              method="post"
              className="grid gap-3 border-t border-sand pt-4 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end"
            >
              {hidden(csrf, "variant-add")}
              <Field label={a.products.sku} name="sku" dir="ltr" />
              <label className="block text-sm font-medium">
                {a.products.color}
                <select name="colorKey" className={inputCls}>
                  {COLOR_KEYS.map((c) => (
                    <option key={c} value={c}>
                      {colorName(c, lang)}
                    </option>
                  ))}
                </select>
              </label>
              <Field label={a.products.priceEgp} name="price" inputMode="decimal" dir="ltr" />
              <Field
                label={a.products.compareAt}
                name="compareAt"
                required={false}
                inputMode="decimal"
                dir="ltr"
              />
              <SubmitButton>{a.products.addVariant}</SubmitButton>
            </Form>
          </section>

          <section
            className="space-y-3 rounded-card border border-sand bg-surface p-5"
            aria-labelledby="media-h"
          >
            <h2 id="media-h" className="text-lg font-bold">
              {a.products.media}
            </h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {product.images.map((m) => (
                <li key={m.id} className="rounded-input border border-sand p-2">
                  <img src={m.url} alt="" className="aspect-[4/3] w-full rounded object-cover" />
                  <Form method="post" className="mt-2">
                    {hidden(csrf, "media-delete")}
                    <input type="hidden" name="mediaId" value={m.id} />
                    <button type="submit" className="text-sm text-cta underline">
                      {a.products.remove}
                    </button>
                  </Form>
                </li>
              ))}
            </ul>
            <Form
              method="post"
              encType="multipart/form-data"
              className="grid gap-3 border-t border-sand pt-4 sm:grid-cols-[1fr_auto] sm:items-end"
            >
              {hidden(csrf, "media-upload")}
              <label className="block text-sm font-medium">
                {a.products.upload}
                <input
                  type="file"
                  name="file"
                  accept="image/jpeg,image/png,image/webp"
                  required
                  className={inputCls}
                />
                <span className="mt-1 block text-xs font-normal text-muted">{a.products.uploadHint}</span>
              </label>
              <SubmitButton>{a.products.upload}</SubmitButton>
            </Form>
          </section>
        </>
      )}
    </div>
  );
}
