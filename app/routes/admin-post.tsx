import { data, Form, Link, useActionData, useOutletContext } from "react-router";
import { ZodError } from "zod";
import type { Route } from "./+types/admin-post";
import type { AdminOutletContext } from "~/layouts/admin";
import { useT } from "~/i18n/context";
import { FormError, FormOk } from "~/components/form";
import { PostFields } from "~/components/post-form";
import { btnOutline, btnPrimary } from "~/components/ui";
import { ForbiddenError } from "../../server/auth/rbac";
import { NotFoundError } from "../../server/catalog/admin";
import { DuplicateSlugError, getPostForEdit, setPostPublished, updatePost } from "../../server/content/posts";
import { requireStaff, requireStaffAction } from "../../server/http/session";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { principal, scope } = await requireStaff(request, context, {
    lang: params.lang,
    permission: "content:write",
  });
  try {
    return { post: await getPostForEdit(scope.db, principal, params.id) };
  } catch (e) {
    if (e instanceof NotFoundError) throw data(null, { status: 404 });
    throw e;
  }
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const { auth, form } = await requireStaffAction(request, context, { lang: params.lang });
  const { scope, principal } = auth;
  try {
    const intent = form.get("intent");
    if (intent === "publish" || intent === "unpublish") {
      await setPostPublished(scope.db, principal, params.id, intent === "publish");
    } else {
      await updatePost(scope.db, principal, params.id, Object.fromEntries(form));
    }
    return { ok: true as const };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "forbidden" as const };
    if (e instanceof DuplicateSlugError) return { error: "duplicateSlug" as const };
    if (e instanceof ZodError || e instanceof NotFoundError) return { error: "invalid" as const };
    throw e;
  }
}

export default function AdminPost({ loaderData }: Route.ComponentProps) {
  const { a, lang } = useT();
  const m = a.modules;
  const { post } = loaderData;
  const result = useActionData<typeof action>();
  const { csrf } = useOutletContext<AdminOutletContext>();
  const published = post.status === "published";
  return (
    <div className="space-y-5">
      <Link to={`/${lang}/admin/posts`} className="text-sm text-cta hover:underline">
        {m.posts}
      </Link>
      <h1 className="text-2xl font-bold">{lang === "ar" ? post.titleAr : post.titleEn}</h1>
      <FormError>{result && "error" in result && result.error ? m[result.error] : null}</FormError>
      <FormOk>{result && "ok" in result ? m.saved : null}</FormOk>

      <Form method="post" className="grid gap-4 rounded-card border border-sand bg-surface p-4">
        <input type="hidden" name="_csrf" value={csrf} />
        <PostFields values={post} />
        <div>
          <button type="submit" className={btnPrimary}>
            {m.savePost}
          </button>
        </div>
      </Form>

      <Form method="post" className="flex items-center gap-3">
        <input type="hidden" name="_csrf" value={csrf} />
        <input type="hidden" name="intent" value={published ? "unpublish" : "publish"} />
        <span className="text-sm text-muted">{published ? m.published : m.draft}</span>
        <button type="submit" className={btnOutline}>
          {published ? m.unpublish : m.publish}
        </button>
      </Form>
    </div>
  );
}
