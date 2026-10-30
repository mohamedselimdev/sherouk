import { Form, Link, redirect, useActionData, useOutletContext } from "react-router";
import { ZodError } from "zod";
import type { Route } from "./+types/admin-posts";
import type { AdminOutletContext } from "~/layouts/admin";
import { useT } from "~/i18n/context";
import { FormError } from "~/components/form";
import { PostFields } from "~/components/post-form";
import { btnPrimary } from "~/components/ui";
import { ForbiddenError } from "../../server/auth/rbac";
import { createPost, DuplicateSlugError, listAllPosts } from "../../server/content/posts";
import { requireStaff, requireStaffAction } from "../../server/http/session";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { principal, scope } = await requireStaff(request, context, {
    lang: params.lang,
    permission: "content:write",
  });
  return { posts: await listAllPosts(scope.db, principal) };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const { auth, form } = await requireStaffAction(request, context, { lang: params.lang });
  try {
    const id = await createPost(auth.scope.db, auth.principal, Object.fromEntries(form));
    return redirect(`/${params.lang}/admin/posts/${id}`);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "forbidden" as const };
    if (e instanceof DuplicateSlugError) return { error: "duplicateSlug" as const };
    if (e instanceof ZodError) return { error: "invalid" as const };
    throw e;
  }
}

export default function AdminPosts({ loaderData }: Route.ComponentProps) {
  const { a, lang } = useT();
  const m = a.modules;
  const result = useActionData<typeof action>();
  const { csrf } = useOutletContext<AdminOutletContext>();
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{m.posts}</h1>
      <FormError>{result && "error" in result && result.error ? m[result.error] : null}</FormError>

      <Form method="post" className="grid gap-4 rounded-card border border-sand bg-surface p-4">
        <input type="hidden" name="_csrf" value={csrf} />
        <PostFields />
        <div>
          <button type="submit" className={btnPrimary}>
            {m.createPost}
          </button>
        </div>
      </Form>

      {loaderData.posts.length === 0 ? (
        <p className="rounded-card bg-panel p-6 text-center text-muted">{m.empty}</p>
      ) : (
        <ul className="grid gap-2 text-sm">
          {loaderData.posts.map((p) => (
            <li key={p.id} className="rounded-input border border-sand bg-surface p-3">
              <Link
                to={`/${lang}/admin/posts/${p.id}`}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <span className="font-semibold">{lang === "ar" ? p.titleAr : p.titleEn}</span>
                <span className="text-muted">{p.status === "published" ? m.published : m.draft}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
